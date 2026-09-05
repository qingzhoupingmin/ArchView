import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { resolveJwtSecret } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [
    PrismaModule,
    // 登录 / 刷新 / 改密要写审计（FR-U09）；AuditModule 只依赖 Prisma，不与本模块成环
    AuditModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // 批次 D / S6：生产缺配或仍是仓库占位值时直接拒绝启动，不再静默兜底成公开密钥
        secret: resolveJwtSecret(config),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard, PermissionsGuard],
  exports: [AuthService, JwtModule, JwtAuthGuard, RolesGuard, PermissionsGuard],
})
export class AuthModule {}
