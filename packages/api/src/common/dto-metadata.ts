import 'reflect-metadata';
import { AuthController } from '../auth/auth.controller';
import { LoginDto, RefreshDto } from '../auth/dto';
import { MeController } from '../me/me.controller';
import { ChangePasswordDto, UpdateMeDto } from '../me/dto';
import { ProjectsController } from '../projects/projects.controller';
import { CreateProjectDto, UpdateProjectDto } from '../projects/dto';
import { UsersController } from '../users/users.controller';
import {
  CreateUserDto,
  ResetPasswordDto,
  SetRoleDto,
  SetStatusDto,
} from '../users/dto';

/**
 * 显式补齐 design:paramtypes 元数据。
 *
 * 背景：全局 ValidationPipe 依赖 @Body() 参数的 design:paramtypes 元数据拿到 DTO 类型；
 * tsc 构建（生产）会自动发射该元数据，但 esbuild 系转译（tsx dev / vitest test）
 * 不发射（esbuild 官方文档：emitDecoratorMetadata 不受支持）→ DTO 会被当成 Object，
 * 校验被静默跳过。此处在「元数据缺失时」显式补齐（不覆盖 tsc 的发射结果）。
 *
 * 注意：数组下标必须与控制器方法的参数位置一一对应（@Req() 位置为 Object）。
 * 新增带 DTO 参数的端点时，在这里补一行。
 */
export function registerDtoMetadata(): void {
  const fill = (target: object, method: string, paramTypes: unknown[]): void => {
    const existing = Reflect.getMetadata('design:paramtypes', target, method);
    if (!existing) {
      Reflect.defineMetadata('design:paramtypes', paramTypes, target, method);
    }
  };

  fill(AuthController.prototype, 'login', [LoginDto, Object]);
  fill(AuthController.prototype, 'refresh', [RefreshDto, Object]);
  fill(AuthController.prototype, 'logout', [Object, RefreshDto]);

  fill(MeController.prototype, 'update', [Object, UpdateMeDto]);
  fill(MeController.prototype, 'changePassword', [Object, ChangePasswordDto]);

  fill(UsersController.prototype, 'create', [CreateUserDto, Object]);
  fill(UsersController.prototype, 'setStatus', [Object, String, SetStatusDto]);
  fill(UsersController.prototype, 'setRole', [Object, String, SetRoleDto]);
  fill(UsersController.prototype, 'resetPassword', [Object, String, ResetPasswordDto]);

  fill(ProjectsController.prototype, 'create', [Object, CreateProjectDto]);
  fill(ProjectsController.prototype, 'update', [Object, String, UpdateProjectDto]);
}