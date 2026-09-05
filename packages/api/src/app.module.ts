import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { join } from 'node:path';
import { AuditModule } from './audit/audit.module';
import { AuditQueryModule } from './audit/audit-query.module';
import { AuthModule } from './auth/auth.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { MeModule } from './me/me.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // 环境变量统一读仓库根 .env（src / dist 两级深度一致）
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(__dirname, '..', '..', '..', '.env'),
    }),
    PrismaModule,
    // 审计（FR-U09）：AuditModule 提供埋点服务，AuditQueryModule 提供超管查询端点（依赖守卫，故分开）
    AuditModule,
    AuthModule,
    AuditQueryModule,
    MeModule,
    UsersModule,
    ProjectsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule {}
