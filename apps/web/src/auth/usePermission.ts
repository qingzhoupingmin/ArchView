import { useCallback } from 'react';
import { hasPermission, type Permission } from '@archview/core';
import { useAuthStore } from './useAuthStore';

/**
 * 按钮级权限（FR-U06 / T1.4）：基于 core 共享权限点常量判断当前用户是否拥有权限。
 * 用法：const can = usePermission(); can(PERMISSIONS.USER_MANAGE)
 */
export function usePermission(): (p: Permission) => boolean {
  const user = useAuthStore((s) => s.user);
  return useCallback((p: Permission) => hasPermission(user?.role ?? null, p), [user]);
}
