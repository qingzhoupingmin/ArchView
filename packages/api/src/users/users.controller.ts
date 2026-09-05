import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PERMISSIONS } from '@archview/core';
import { AuthRequest } from '../auth/auth.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Permissions } from '../auth/permissions.decorator';
import { CreateUserDto, ResetPasswordDto, SetRoleDto, SetStatusDto } from './dto';
import { ListUsersQuery, UsersService } from './users.service';

/**
 * 用户管理（FR-U05 / T1.3）：仅超管可访问（权限点 USER_MANAGE，前后端共享 core 常量）。
 * 行操作：启禁用 / 重置密码 / 调角色 / 软删。
 */
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions(PERMISSIONS.USER_MANAGE)
export class UsersController {
  // @Inject 显式令牌：不依赖 design:paramtypes（esbuild/tsx/vitest 转换下元数据可能缺失）
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  list(@Query() query: ListUsersQuery) {
    return this.users.list(query);
  }

  @Post()
  create(@Body() dto: CreateUserDto, @Req() req: AuthRequest) {
    return this.users.create(dto, req.user, req.ip ?? null);
  }

  @Patch(':id/status')
  setStatus(@Req() req: AuthRequest, @Param('id') id: string, @Body() dto: SetStatusDto) {
    return this.users.setStatus(id, dto.status, req.user, req.ip ?? null);
  }

  @Post(':id/password')
  resetPassword(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.users.resetPassword(id, dto.password, req.user, req.ip ?? null);
  }

  @Patch(':id/role')
  setRole(@Req() req: AuthRequest, @Param('id') id: string, @Body() dto: SetRoleDto) {
    return this.users.setRole(id, dto.role, req.user, req.ip ?? null);
  }

  /** 默认软删（可恢复）；`?purge=true` 硬删并连带回收其名下工程（批次 D / S8，仅超管） */
  @Delete(':id')
  remove(@Req() req: AuthRequest, @Param('id') id: string, @Query('purge') purge?: string) {
    const hard = purge === 'true' || purge === '1';
    return this.users.remove(id, req.user, req.ip ?? null, hard);
  }
}
