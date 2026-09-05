import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT, AuditService } from '../audit/audit.service';
import { LoginDto, RefreshDto } from './dto';

export interface AuthTokens {
  access: string;
  refresh: string;
}

export interface AuthUserView {
  id: string;
  username: string;
  nickname: string;
  role: 'super_admin' | 'user';
  email: string | null;
  avatar: string | null;
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
}

interface UserRow {
  id: string;
  username: string;
  passwordHash: string;
  nickname: string;
  role: string;
  email: string | null;
  avatar: string | null;
  status: string;
  mustChangePassword: boolean;
}

const ACCESS_TTL = '2h';
const REFRESH_TTL = '7d';
const REFRESH_TTL_MS = 7 * 24 * 3600 * 1000;

/** 登录失败锁定（FR-U01：连续 5 次失败锁定 5 分钟）—— 按「来源 IP + 用户名」计 */
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;
/**
 * 账号级慢计数（数据隔离专项·批次 D / S7）：
 * 旧实现只按用户名计数，任何人对 `admin` 连敲 5 次错密码就能把真超管锁在门外 5 分钟（锁定 DoS）。
 * 现在单来源 5 次即锁该来源；要打锁整个账号需跨来源在窗口内累计 30 次，兼顾防爆破与不误伤。
 */
const ACCOUNT_FAIL_WINDOW_MS = 60 * 60 * 1000;
const ACCOUNT_MAX_FAILS = 30;

interface FailRecord {
  fails: number;
  /** 锁定截止时间戳（0 表示未锁定） */
  lockedUntil: number;
}

interface AccountFailRecord {
  fails: number;
  /** 窗口起点（滑动窗口：超窗即重置） */
  windowStart: number;
  lockedUntil: number;
}

/**
 * 认证服务（FR-U01 / U03 / U04 / U06）：
 * - argon2id 校验 + JWT（access 2h / refresh 7d）；失败统一「用户名或密码错误」防枚举；
 * - 登录锁定：单来源连续 5 次失败锁 5 分钟，账号级跨来源 60 分钟 30 次兜底；
 * - RefreshToken 白名单（FR-U03）：登出吊销 / refresh 轮换 / 多端并存 / 改密与禁用强制下线；
 * - 单实例内存计数（多实例部署时迁移到 Redis）；登录/登出/改密全程写审计（FR-U09）。
 */
@Injectable()
export class AuthService {
  // @Inject 显式令牌：不依赖 design:paramtypes（esbuild/tsx/vitest 转换下元数据可能缺失）
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** 登录失败计数（内存态；key 为 `${ip}|${小写用户名}`，防大小写与单点刷锁） */
  private readonly loginFails = new Map<string, FailRecord>();
  /** 账号级失败计数（滑动窗口，防分布式锁定 DoS） */
  private readonly accountFails = new Map<string, AccountFailRecord>();

  async login(dto: LoginDto, ip?: string | null) {
    const username = dto.username.trim();
    const nameKey = username.toLowerCase();
    const now = Date.now();
    const ipKey = `${ip ?? 'unknown'}|${nameKey}`;

    // 1) 来源级锁（FR-U01 原语义）
    const ipRecord = this.loginFails.get(ipKey);
    if (ipRecord && ipRecord.lockedUntil > now) {
      throw this.lockedException(ipRecord.lockedUntil, nameKey, ip);
    }
    // 2) 账号级兜底锁（跨来源累计，防「5 次就锁死管理员」的 DoS）
    const acct = this.accountFails.get(nameKey);
    if (acct && acct.lockedUntil > now) {
      throw this.lockedException(acct.lockedUntil, nameKey, ip);
    }

    const user = await this.prisma.user.findUnique({ where: { username } });
    // 防枚举：不存在 / 禁用 / 软删 / 密码错误 → 同一文案（FR-U05 禁用后不可登录）
    const ok =
      !!user && !user.deletedAt && user.status === 'active'
        ? await argon2.verify(user.passwordHash, dto.password)
        : false;
    if (!user || !ok) {
      this.registerFailure(ipKey, nameKey, now);
      this.audit.record({
        userId: user && !user.deletedAt ? user.id : null,
        ip,
        action: AUDIT.LOGIN_FAIL,
        target: user?.id ?? null,
        detail: { username: nameKey },
      });
      throw new UnauthorizedException('用户名或密码错误');
    }

    this.loginFails.delete(ipKey);
    this.accountFails.delete(nameKey);
    const tokens = await this.issueTokens(user.id);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    this.audit.record({ userId: user.id, ip, action: AUDIT.LOGIN });
    return { ...tokens, user: this.toView(user), mustChangePassword: user.mustChangePassword };
  }

  /** 抛 429（Nest 10 无 TooManyRequestsException，用 HttpException 构造） */
  private lockedException(lockedUntil: number, username: string, ip?: string | null) {
    const retryAfter = Math.ceil((lockedUntil - Date.now()) / 1000);
    this.audit.record({
      ip,
      action: AUDIT.LOGIN_LOCKED,
      detail: { username, retryAfter },
    });
    return new HttpException(
      { code: 'LOGIN_LOCKED', message: '连续失败次数过多，请稍后再试', detail: { retryAfter } },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** 记一次失败：来源级 5 次锁该来源 5 分钟；账号级 60 分钟内 30 次锁该账号 5 分钟 */
  private registerFailure(ipKey: string, nameKey: string, now: number): void {
    const ipRecord = this.loginFails.get(ipKey) ?? { fails: 0, lockedUntil: 0 };
    const fails = ipRecord.fails + 1;
    this.loginFails.set(ipKey, {
      fails,
      lockedUntil: fails >= MAX_FAILS ? now + LOCK_MS : 0,
    });

    const acct = this.accountFails.get(nameKey);
    const fresh = !acct || now - acct.windowStart > ACCOUNT_FAIL_WINDOW_MS;
    const count = (fresh ? 0 : acct!.fails) + 1;
    this.accountFails.set(nameKey, {
      fails: count,
      windowStart: fresh ? now : acct!.windowStart,
      lockedUntil: count >= ACCOUNT_MAX_FAILS ? now + LOCK_MS : (acct?.lockedUntil ?? 0),
    });
  }

  /** 无感刷新（FR-U03）：校验白名单 → 轮换（旧令牌吊销，防重放） */
  async refresh(dto: RefreshDto, ip?: string | null) {
    const payload = await this.verifyRefresh(dto.refresh);
    const row = await this.prisma.refreshToken.findUnique({ where: { jti: payload.jti } });
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.deletedAt || user.status !== 'active') {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
    if (!row || row.revoked || row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
    await this.prisma.refreshToken.update({ where: { jti: row.jti }, data: { revoked: true } });
    const tokens = await this.issueTokens(user.id);
    this.audit.record({ userId: user.id, ip, action: AUDIT.REFRESH });
    return tokens;
  }

  /** 登出（幂等）：吊销白名单中的 refresh 记录（FR-U03 登出吊销） */
  async logout(dto: RefreshDto) {
    try {
      const payload = await this.verifyRefresh(dto.refresh);
      await this.prisma.refreshToken
        .updateMany({ where: { jti: payload.jti, revoked: false }, data: { revoked: true } })
        .catch(() => null);
    } catch {
      /* 令牌已失效也按幂等处理，不报错 */
    }
  }

  async me(userId: string): Promise<AuthUserView> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('登录已过期，请重新登录');
    return this.toView(user);
  }

  /** 个人资料（FR-U04）：修改昵称 / 邮箱 / 预设头像（v1 不做上传） */
  async updateProfile(
    userId: string,
    dto: { nickname?: string; email?: string | null; avatar?: string | null },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('登录已过期，请重新登录');
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.nickname !== undefined ? { nickname: dto.nickname } : {}),
        ...(dto.email !== undefined ? { email: dto.email || null } : {}),
        ...(dto.avatar !== undefined ? { avatar: dto.avatar || null } : {}),
      },
    });
    return this.toView(updated);
  }

  /**
   * 修改密码（FR-U04）：验证旧密码 → 新密码 → 清除首次改密标记。
   * 吊销该用户全部 refresh（其它设备下线；当前设备 access 2h 内仍可用）。
   */
  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
    ip?: string | null,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('登录已过期，请重新登录');
    const ok = await argon2.verify(user.passwordHash, oldPassword);
    if (!ok) throw new BadRequestException('原密码不正确');
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });
    await this.prisma.refreshToken.updateMany({ where: { userId }, data: { revoked: true } });
    this.audit.record({ userId, ip, action: AUDIT.PASSWORD_CHANGE, target: userId });
    return this.toView(updated);
  }

  /** 签发令牌对并登记 refresh 白名单（FR-U03 多端并存：每次签发独立 jti） */
  private async issueTokens(userId: string): Promise<AuthTokens> {
    const access = await this.jwt.signAsync({ sub: userId }, { expiresIn: ACCESS_TTL });
    const jti = randomUUID();
    const refresh = await this.jwt.signAsync({ sub: userId, type: 'refresh', jti }, { expiresIn: REFRESH_TTL });
    await this.prisma.refreshToken.create({
      data: { jti, userId, expiresAt: new Date(Date.now() + REFRESH_TTL_MS) },
    });
    // 顺手清理该用户已过期令牌（防止表无限增长）
    await this.prisma.refreshToken
      .deleteMany({ where: { userId, expiresAt: { lt: new Date() } } })
      .catch(() => null);
    return { access, refresh };
  }

  private async verifyRefresh(token: string): Promise<{ sub: string; jti: string }> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; type?: string; jti?: string }>(token);
      const { sub, type, jti } = payload;
      if (type !== 'refresh' || !jti) throw new Error('not a refresh token');
      return { sub, jti };
    } catch {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
  }

  private toView(user: UserRow): AuthUserView {
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role === 'super_admin' ? 'super_admin' : 'user',
      email: user.email,
      avatar: user.avatar,
      status: user.status === 'disabled' ? 'disabled' : 'active',
      mustChangePassword: user.mustChangePassword,
    };
  }
}
