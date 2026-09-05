import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { Actor } from './actor';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Bearer Token 守卫：解析 Authorization: Bearer <access>，校验后注入 req.user（Actor）。
 * 401 消息统一「未登录」/「登录已过期，请重新登录」（前端触发无感刷新，FR-U03）。
 *
 * 数据隔离专项·批次 B / S4：验签成功后**还要查库**确认账号存在、未软删、状态 active。
 * 旧实现只验签 → access 有效期 2h 内，被禁用甚至被软删的账号仍能以原令牌读写数据，
 * 软删的超管更能继续调 /users 建号改角色（PermissionsGuard 当时只看 role）。
 * 代价是每请求一次主键查询：SQLite 是本地文件库、单行 findUnique，成本可忽略，
 * 换来「管理员一禁用，会话立刻失效」的正确语义。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  // @Inject 显式令牌：不依赖 design:paramtypes（esbuild/tsx/vitest 转换下元数据可能缺失）
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: Actor }>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) throw new UnauthorizedException('未登录');
    let sub: string;
    try {
      const payload = this.jwt.verify<{ sub: string; type?: string }>(header.slice('Bearer '.length));
      // refresh 令牌不得当 access 用（否则拿 7 天有效的凭据就能直接打业务接口）
      if (!payload.sub || payload.type === 'refresh') throw new Error('bad access token');
      sub = payload.sub;
    } catch {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: sub },
      select: { id: true, role: true, status: true, deletedAt: true },
    });
    if (!user || user.deletedAt || user.status !== 'active') {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
    req.user = { id: user.id, role: user.role };
    return true;
  }
}
