import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Actor } from './actor';
import { PrismaService } from '../prisma/prisma.service';
import { ROLES_KEY } from './roles.decorator';

/** 角色守卫（FR-U05）：@Roles('super_admin') 限制仅超管访问 */
@Injectable()
export class RolesGuard implements CanActivate {
  // @Inject 显式令牌：不依赖 design:paramtypes（esbuild/tsx/vitest 转换下元数据可能缺失）
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: Actor }>();
    if (!req.user) return false;
    // 批次 B：优先用 JwtAuthGuard 查库注入的角色（已确认账号 active 且未软删）
    let role = req.user.role;
    if (!role) {
      const user = await this.prisma.user.findUnique({
        where: { id: req.user.id },
        select: { role: true, status: true, deletedAt: true },
      });
      if (!user || user.deletedAt || user.status !== 'active') {
        throw new ForbiddenException('用户不存在');
      }
      role = user.role;
    }
    if (!roles.includes(role)) throw new ForbiddenException('需要超管权限');
    return true;
  }
}
