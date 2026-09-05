import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectRepository } from './project.repository';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [PrismaModule, AuthModule, AuditModule],
  controllers: [ProjectsController],
  // ProjectRepository 是工程归属过滤的唯一入口（批次 B）：显式登记并导出，
  // 让「按属主统计」这类需求也走收口层，而不是各自再写一遍 where。
  providers: [ProjectsService, ProjectRepository],
  exports: [ProjectsService, ProjectRepository],
})
export class ProjectsModule {}
