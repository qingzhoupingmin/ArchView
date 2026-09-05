import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import argon2 from 'argon2';
import type { Actor } from '../auth/actor';
import { AUDIT, AuditService } from '../audit/audit.service';
import { ProjectRepository } from '../projects/project.repository';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto';

/** 用户列表筛选（FR-U05：搜索 / 角色筛选 / 状态筛选；软删用户不展示） */
export interface ListUsersQuery {
  q?: string;
  role?: string;
  status?: string;
}

export interface UserSummary {
  id: string;
  username: string;
  nickname: string;
  role: 'super_admin' | 'user';
  email: string | null;
  avatar: string | null;
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}

/** 用户管理（FR-U05 / T1.3）：列表 / 创建 / 启禁用 / 软删 / 重置密码 / 调角色 + 最后超管保护 */
@Injectable()
export class UsersService {
  // @Inject 显式令牌：不依赖 design:paramtypes（esbuild/tsx/vitest 转换下元数据可能缺失）
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    // 硬删账号要知道会连带清掉多少工程：归属统计同样走 ProjectRepository（闸门要求）
    @Inject(ProjectRepository) private readonly projects: ProjectRepository,
  ) {}

  async list(query: ListUsersQuery): Promise<UserSummary[]> {
    // Prisma 5.22 的 SQLite StringFilter 无 mode:'insensitive'，用户名为小写约定 → 直接小写匹配
    const q = query.q?.trim().toLowerCase();
    const rows = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(query.role === 'super_admin' || query.role === 'user' ? { role: query.role } : {}),
        ...(query.status === 'active' || query.status === 'disabled'
          ? { status: query.status }
          : {}),
        ...(q
          ? {
              OR: [
                { username: { contains: q } },
                { nickname: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((u) => this.toSummary(u));
  }

  async create(dto: CreateUserDto, operator: Actor, ip?: string | null) {
    const exists = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (exists) {
      throw new ConflictException(
        exists.deletedAt
          ? '该用户名曾被一个已删除的账号占用（v1 不允许复用，以防数据归属错认）'
          : '用户名已存在',
      );
    }
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        nickname: dto.nickname ?? dto.username,
        role: dto.role === 'super_admin' ? 'super_admin' : 'user',
        email: dto.email,
        passwordHash,
      },
    });
    this.audit.record({
      userId: operator.id,
      ip,
      action: AUDIT.USER_CREATE,
      target: user.id,
      detail: { username: user.username, role: user.role },
    });
    return this.toSummary(user);
  }

  /** 启用 / 禁用（FR-U05：禁用后不可登录；禁用时吊销其全部 refresh → 强制下线） */
  async setStatus(id: string, status: 'active' | 'disabled', operator: Actor, ip?: string | null) {
    await this.requireUser(id);
    if (id === operator.id && status === 'disabled') {
      throw new BadRequestException('不能禁用当前登录账号');
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: status === 'disabled' ? 'disabled' : 'active' },
    });
    if (status === 'disabled') {
      await this.prisma.refreshToken.updateMany({ where: { userId: id }, data: { revoked: true } });
    }
    this.audit.record({
      userId: operator.id,
      ip,
      action: AUDIT.USER_STATUS,
      target: id,
      detail: { status },
    });
    return this.toSummary(updated);
  }

  /** 重置密码（FR-U05）：新密码立即生效 + 首次登录强制改密 + 吊销旧 refresh */
  async resetPassword(id: string, newPassword: string, operator: Actor, ip?: string | null) {
    await this.requireUser(id);
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    const updated = await this.prisma.user.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true },
    });
    await this.prisma.refreshToken.updateMany({ where: { userId: id }, data: { revoked: true } });
    this.audit.record({ userId: operator.id, ip, action: AUDIT.USER_RESET_PASSWORD, target: id });
    return this.toSummary(updated);
  }

  /** 调整角色（FR-U05）：最后一名超管不可降级 */
  async setRole(
    id: string,
    role: 'user' | 'super_admin',
    operator: Actor,
    ip?: string | null,
  ) {
    const user = await this.requireUser(id);
    const demotingLastAdmin =
      user.role === 'super_admin' && role === 'user' && (await this.countSuperAdmins()) <= 1;
    if (demotingLastAdmin) throw new BadRequestException('不能降级最后一名超级管理员');
    if (id === operator.id && role !== 'super_admin') {
      throw new BadRequestException('不能调整当前登录账号的角色');
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: { role: role === 'super_admin' ? 'super_admin' : 'user' },
    });
    this.audit.record({
      userId: operator.id,
      ip,
      action: AUDIT.USER_ROLE,
      target: id,
      detail: { from: user.role, to: role },
    });
    return this.toSummary(updated);
  }

  /**
   * 删除账号（FR-U05 默认软删：列表不展示、可恢复）。
   *
   * 批次 B / S4：软删时一并吊销该账号全部 refresh —— 与 setStatus(disabled) 口径对齐。
   * 此前这里漏了吊销，被删账号仅靠 refresh() 里的 deletedAt 判定挡住续签，
   * 属于「一层防御裸奔」；而 access 令牌（2h）的失效则由 JwtAuthGuard 查库补齐。
   *
   * 批次 D / S8：`purge=true` 走硬删 —— FK `onDelete: Cascade` 连带回收其工程，
   * 用于离职清理，消灭「工程永久挂在已删账号名下」的孤儿数据。默认仍为软删。
   */
  async remove(id: string, operator: Actor, ip?: string | null, purge = false) {
    const user = await this.requireUser(id);
    if (user.role === 'super_admin' && (await this.countSuperAdmins()) <= 1) {
      throw new BadRequestException('不能删除最后一名超级管理员');
    }
    if (id === operator.id) throw new BadRequestException('不能删除当前登录账号');
    await this.prisma.refreshToken.updateMany({ where: { userId: id }, data: { revoked: true } });
    if (purge) {
      const projects = await this.projects.countByOwner(id);
      await this.prisma.user.delete({ where: { id } });
      this.audit.record({
        userId: operator.id,
        ip,
        action: AUDIT.USER_PURGE,
        target: id,
        detail: { username: user.username, cascadedProjects: projects },
      });
      return { id, purged: true, cascadedProjects: projects };
    }
    await this.prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
    this.audit.record({
      userId: operator.id,
      ip,
      action: AUDIT.USER_DELETE,
      target: id,
      detail: { username: user.username },
    });
    return { id, purged: false };
  }

  private async requireUser(id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('用户不存在');
    return user;
  }

  /** 未软删的超管数量（最后超管保护用） */
  private countSuperAdmins() {
    return this.prisma.user.count({ where: { role: 'super_admin', deletedAt: null } });
  }

  private toSummary(u: {
    id: string;
    username: string;
    nickname: string;
    role: string;
    email: string | null;
    avatar: string | null;
    status: string;
    mustChangePassword: boolean;
    createdAt: Date;
    lastLoginAt: Date | null;
  }): UserSummary {
    return {
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      role: u.role === 'super_admin' ? 'super_admin' : 'user',
      email: u.email,
      avatar: u.avatar,
      status: u.status === 'disabled' ? 'disabled' : 'active',
      mustChangePassword: u.mustChangePassword,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
    };
  }
}
