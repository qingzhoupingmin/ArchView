import { hasPermission, type Permission } from '@archview/core';
import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Actor } from './actor';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSIONS_KEY } from './permissions.decorator';

/**
 * 权限点守卫（FR-U06 / T1.4）：@Permissions(PERMISSIONS.X) 按 RBAC 权限点放行。
 * 权限点 → 角色映射统一走 @archview/core 的 hasPermission（前后端共享）。
 *
 * 批次 B / S4：角色直接取 JwtAuthGuard 查库注入的 req.user —— 该令牌已过「存在 + 未软删 + active」
 * 校验，故被禁用/软删的超管不会再在这里放行（旧实现只按 id 回查、只看 role，不看状态）。
 * req.user 缺失时兜底回查一次库，保证本守卫可独立使用。
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  // @Inject 显式令牌：不依赖 design:paramtypes（esbuild/tsx/vitest 转换下元数据可能缺失）
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permissions = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permissions || permissions.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: Actor }>();
    if (!req.user) return false;
    let role = req.user.role;
    if (!role) {
      const user = await this.prisma.user.findUnique({
        where: { id: req.user.id },
        select: { role: true, status: true, deletedAt: true },
      });
      if (!user || user.deletedAt || user.status !== 'active') throw new ForbiddenException('用户不存在');
      role = user.role;
    }
    if (!permissions.every((p) => hasPermission(role, p))) {
      throw new ForbiddenException('需要更高权限');
    }
    return true;
  }
}
