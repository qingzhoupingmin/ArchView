import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { Actor } from './actor';
import { AUDIT, AuditService } from '../audit/audit.service';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto } from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';

export type AuthRequest = Request & { user: Actor };

/** 来源 IP（批次 D：登录锁定按 IP 维度叠加；反代场景由 main.ts 的 trust proxy 还原） */
const ipOf = (req: Request): string | null => req.ip ?? null;

/** 认证接口（FR-U01 / U03 / U06） */
@Controller('auth')
export class AuthController {
  // @Inject 显式令牌：不依赖 design:paramtypes（esbuild/tsx/vitest 转换下元数据可能缺失）
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, ipOf(req));
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto, ipOf(req));
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req: AuthRequest, @Body() dto: RefreshDto) {
    await this.auth.logout(dto);
    this.audit.record({ userId: req.user.id, ip: ipOf(req), action: AUDIT.LOGOUT });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: AuthRequest) {
    return this.auth.me(req.user.id);
  }
}
