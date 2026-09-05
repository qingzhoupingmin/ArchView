import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
/** 角色要求（配合 RolesGuard 使用），如 @Roles('super_admin') */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
