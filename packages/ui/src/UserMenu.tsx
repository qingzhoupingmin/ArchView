import { useState } from 'react';

/**
 * 用户菜单（P3 阶段 C 收口）。
 *
 * 此前 AppHeader 与 TopBar 各写了一份几乎相同的头像下拉菜单（约 40 行 × 2），
 * 结果已经出现行为漂移：AppHeader 有「切换深色界面」，TopBar 没有 —— 用户在建模页
 * 找不到主题开关。这里合并为单一实现，两处差异全部改为 props 注入。
 *
 * 本组件不 import apps/web 的任何 store：权限判定、主题状态、导航与登出全部由调用方
 * 传入，保证 @archview/ui 仍是无业务依赖的原语包。
 */

/** 菜单需要的最小用户结构（与 api client 的 User 结构兼容，避免反向依赖） */
export interface UserMenuUser {
  username: string;
  nickname?: string;
  avatar?: string | null;
  role?: string;
}

/** 头像字符：emoji 优先，否则取昵称 / 用户名的首个字符大写（两处顶栏此前各写一遍） */
export function avatarChar(user?: UserMenuUser | null): string {
  if (!user) return 'U';
  if (user.avatar) return user.avatar;
  return (user.nickname || user.username || 'U').slice(0, 1).toUpperCase();
}

/** 角色中文标签：与 core 的 ROLE_LABELS 语义一致，但不依赖 core（保持原语包纯净） */
function roleLabel(user?: UserMenuUser | null): string {
  return user?.role === 'super_admin' ? '超级管理员' : '普通用户';
}

export interface UserMenuProps {
  user: UserMenuUser | null;
  /** 无 USER_MANAGE 权限时隐藏「管理中心」（FR-U06） */
  canManageUsers?: boolean;
  /** 传入则渲染「切换深色 / 浅色界面」项；不传则该菜单无主题入口 */
  theme?: {
    dark: boolean;
    onToggle: () => void;
  };
  /**
   * 传入则在菜单顶部渲染「工程列表」项（建模页专用：那里没有应用页头的主导航，
   * 否则用户只能靠顶栏返回按钮回主界面）。AppHeader 已有主导航，不传即不显示。
   */
  projectsTo?: string;
  onNavigate: (to: string) => void;
  onLogout: () => void;
  /** 头像按钮的样式类：顶栏 32px 用 'avatar'，页头紧凑档用 'avatar avatar-sm' */
  avatarClassName?: string;
}

export function UserMenu({
  user,
  canManageUsers = false,
  theme,
  projectsTo,
  onNavigate,
  onLogout,
  avatarClassName = 'avatar',
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const go = (to: string) => {
    setOpen(false);
    onNavigate(to);
  };
  const act = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div className="topbar-user">
      <button
        className={avatarClassName}
        onClick={() => setOpen((v) => !v)}
        title="用户菜单"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {avatarChar(user)}
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu" role="menu">
            <div className="menu-title">
              {user?.nickname ?? '未登录'}
              <span className="muted">{' · ' + roleLabel(user)}</span>
            </div>
            {projectsTo && (
              <button className="menu-item" role="menuitem" onClick={() => go(projectsTo)}>
                工程列表
              </button>
            )}
            <button className="menu-item" role="menuitem" onClick={() => go('/profile')}>
              个人中心
            </button>
            {canManageUsers && (
              <button className="menu-item" role="menuitem" onClick={() => go('/admin')}>
                管理中心
              </button>
            )}
            {theme && (
              <button className="menu-item" role="menuitem" onClick={() => act(theme.onToggle)}>
                {theme.dark ? '切换浅色界面（实验）' : '切换深色界面（实验）'}
              </button>
            )}
            <button
              className="menu-item menu-item-danger"
              role="menuitem"
              onClick={() => act(onLogout)}
            >
              退出登录
            </button>
          </div>
        </>
      )}
    </div>
  );
}
