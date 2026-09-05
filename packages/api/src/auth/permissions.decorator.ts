import type { Permission } from '@archview/core';
import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * 权限点要求（配合 PermissionsGuard 使用，FR-U06 / T1.4）。
 * 权限点常量来自 @archview/core（前端按钮级权限与后端路由守卫共享同一份定义）。
 * 例：@Permissions(PERMISSIONS.USER_MANAGE)
 */
export const Permissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);
