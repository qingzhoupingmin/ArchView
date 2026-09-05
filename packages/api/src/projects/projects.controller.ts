import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthRequest } from '../auth/auth.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateProjectDto, UpdateProjectDto } from './dto';
import { ProjectsService } from './projects.service';

/**
 * 工程接口（FR-U07）。
 * 隔离口径：一律以 req.user（JwtAuthGuard 查库注入的 Actor）为归属依据，
 * 不接收任何来自客户端的 userId / ownerId；`req.ip` 透传给服务层做审计留痕。
 */
@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  // @Inject 显式令牌：不依赖 design:paramtypes（esbuild/tsx/vitest 转换下元数据可能缺失）
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get()
  list(@Req() req: AuthRequest) {
    return this.projects.listFor(req.user);
  }

  @Post()
  create(@Req() req: AuthRequest, @Body() dto: CreateProjectDto) {
    return this.projects.create(req.user, dto, req.ip ?? null);
  }

  @Get(':id')
  getFull(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.projects.getFull(req.user, id, req.ip ?? null);
  }

  @Patch(':id')
  update(@Req() req: AuthRequest, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(req.user, id, dto, req.ip ?? null);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.projects.remove(req.user, id, req.ip ?? null);
  }
}
