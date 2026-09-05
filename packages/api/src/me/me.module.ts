import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MeController } from './me.controller';

/** 个人资料模块（FR-U04 / T1.2）：GET/PATCH /me · POST /me/password */
@Module({
  imports: [AuthModule],
  controllers: [MeController],
})
export class MeModule {}
