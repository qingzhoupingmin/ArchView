import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditService } from './audit.service';

/**
 * 操作日志服务模块（FR-U09 · 批次 D）。
 * 只导出 AuditService、不含控制器：埋点方（auth / users / projects）都依赖它，
 * 而它的查询端点又需要 AuthModule 的守卫 —— 若合成一个模块，
 * auth.module ↔ audit.module 会在 ESM 文件层面互相 import 成环，
 * Nest 启动时拿到的 AuthModule 是 undefined（报 "Nest cannot create the AuthModule instance"）。
 * 故拆成两个文件：本模块纯服务，查询端点在 audit-query.module.ts。
 */
@Module({
  imports: [PrismaModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}


