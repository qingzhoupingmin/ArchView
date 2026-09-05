import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { PERMISSIONS } from '@archview/core';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AuditQuery, AuditService } from './audit.service';

/**
 * 操作日志查询（FR-U09 · 批次 D）：仅持 oplog:view 权限点可访问。
 * 查询参数走手动收敛（AuditService.list 内 clamp），故不注册 DTO 校验元数据。
 */
@Controller('audit')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions(PERMISSIONS.OP_LOG_VIEW)
export class AuditController {
  // @Inject 显式令牌：不依赖 design:paramtypes（esbuild/tsx/vitest 转换下元数据可能缺失）
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  list(@Query() query: AuditQuery) {
    return this.audit.list(query);
  }
}
