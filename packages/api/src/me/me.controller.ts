import { Body, Controller, Get, Inject, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChangePasswordDto, UpdateMeDto } from './dto';

type MeRequest = Request & { user: { id: string } };

/** 个人资料（产品文档 §8.4：GET/PATCH /api/v1/me · POST /api/v1/me/password） */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  // @Inject 显式令牌：不依赖 design:paramtypes（esbuild/tsx/vitest 转换下元数据可能缺失）
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  me(@Req() req: MeRequest) {
    return this.auth.me(req.user.id);
  }

  @Patch()
  update(@Req() req: MeRequest, @Body() dto: UpdateMeDto) {
    return this.auth.updateProfile(req.user.id, dto);
  }

  @Post('password')
  changePassword(@Req() req: MeRequest, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(req.user.id, dto.oldPassword, dto.newPassword, req.ip ?? null);
  }
}
