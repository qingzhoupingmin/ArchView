/**
 * RBAC 权限点（FR-U06 / 开发计划 T1.4）：
 * 权限点常量由 core 统一导出，前端（按钮级权限）与后端（路由守卫）共享同一份定义，
 * 避免前后端各写一份导致漂移（产品文档 R9 风险应对）。
 * v1 仅两级角色；权限点模型预留中间角色扩展（如「项目管理员」）。
 */

/** 角色（v1 内置两级，产品文档 §5.7 FR-U06） */
export type Role = 'super_admin' | 'user';

/** 权限点常量（命名：<域>:<动作>） */
export const PERMISSIONS = {
  /** 用户管理（超管）：用户列表 / 创建 / 启禁用 / 软删 / 重置密码 / 调角色（FR-U05） */
  USER_MANAGE: 'user:manage',
  /** 系统设置（超管）：站点名称 / 注册模式 / 默认值（FR-U07，P3 接入） */
  SYSTEM_SETTINGS: 'system:settings',
  /** 查看全部工程（超管；普通用户仅见本人工程，FR-U06 / FR-U08） */
  PROJECT_VIEW_ALL: 'project:view-all',
  /** 操作日志（超管，FR-U09，P3 接入） */
  OP_LOG_VIEW: 'oplog:view',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** 角色 → 权限点集合 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: [
    PERMISSIONS.USER_MANAGE,
    PERMISSIONS.SYSTEM_SETTINGS,
    PERMISSIONS.PROJECT_VIEW_ALL,
    PERMISSIONS.OP_LOG_VIEW,
  ],
  user: [],
};

/** 判断角色是否拥有权限点（role 为空 / 未知时一律 false） */
export function hasPermission(
  role: Role | string | null | undefined,
  permission: Permission,
): boolean {
  if (!role) return false;
  const grants = ROLE_PERMISSIONS[role as Role];
  return grants ? grants.includes(permission) : false;
}

/** 角色显示名（前端 UI 用） */
export const ROLE_LABELS: Record<Role, string> = {
  super_admin: '超级管理员',
  user: '普通用户',
};
