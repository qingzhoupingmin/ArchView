import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditController } from './audit.controller';
import { AuditModule } from './audit.module';

/**
 * 操作日志查询端点模块（仅 oplog:view 的超管可访问）。
 * 与 AuditModule（纯服务）分文件：本模块要引 AuthModule 拿守卫，
 * 而 AuthModule 又要引 AuditModule 做埋点 —— 合在一起就成环（见 audit.module.ts 说明）。
 */
@Module({
  imports: [AuditModule, AuthModule],
  controllers: [AuditController],
})
export class AuditQueryModule {}
