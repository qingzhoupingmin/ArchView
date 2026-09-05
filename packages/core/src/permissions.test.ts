/** RBAC 权限点单测（FR-U06 / T1.4：前后端共享同一份权限常量） */
import { describe, expect, it } from 'vitest';
import { hasPermission, PERMISSIONS, ROLE_PERMISSIONS } from './permissions';

describe('hasPermission（FR-U06）', () => {
  it('超管拥有全部权限点', () => {
    for (const p of Object.values(PERMISSIONS)) {
      expect(hasPermission('super_admin', p)).toBe(true);
    }
  });

  it('普通用户无权限点（工程管理仅本人，FR-U06）', () => {
    for (const p of Object.values(PERMISSIONS)) {
      expect(hasPermission('user', p)).toBe(false);
    }
  });

  it('role 为空 / 未知角色 → false（防御非法 role 值）', () => {
    expect(hasPermission(null, PERMISSIONS.USER_MANAGE)).toBe(false);
    expect(hasPermission(undefined, PERMISSIONS.USER_MANAGE)).toBe(false);
    expect(hasPermission('', PERMISSIONS.USER_MANAGE)).toBe(false);
    expect(hasPermission('admin', PERMISSIONS.USER_MANAGE)).toBe(false);
  });

  it('角色权限表完整：super_admin 4 个权限点，user 0 个', () => {
    expect(ROLE_PERMISSIONS.super_admin).toHaveLength(4);
    expect(ROLE_PERMISSIONS.user).toHaveLength(0);
  });
});
