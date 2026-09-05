import { type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PERMISSIONS } from '@archview/core';
import { BrandMark, Icon, type IconName, UserMenu } from '@archview/ui';
import { useAuthStore } from '../auth/useAuthStore';
import { usePermission } from '../auth/usePermission';
import { useThemeStore } from '../store/useThemeStore';

type NavKey = 'projects' | 'profile' | 'admin';

const NAV: {
  key: NavKey;
  to: string;
  label: string;
  /** P4 大屏桌面化：主导航带图标，宽屏下一眼定位，不必逐条读字 */
  icon: IconName;
  adminOnly?: boolean;
}[] = [
  { key: 'projects', to: '/', label: '工程列表', icon: 'folder' },
  { key: 'profile', to: '/profile', label: '个人中心', icon: 'user' },
  { key: 'admin', to: '/admin', label: '管理中心', icon: 'shield', adminOnly: true },
];

interface AppHeaderProps {
  /** 当前高亮页签 */
  active?: NavKey;
  /** 右侧额外动作（如页面级主按钮） */
  actions?: ReactNode;
}

/**
 * 应用页头（P1 布局优化）：工程列表 / 个人中心 / 管理中心共用同一套
 * 品牌 + 主导航 + 用户菜单，取代此前 .ws-header 被三处借用、管理中心无顶栏的不一致。
 * 建模主界面（/project/:id）使用工具栏形态的 TopBar，不在本组件职责内。
 * P3 阶段 C：用户菜单改由 @archview/ui 的 UserMenu 提供，与 TopBar 共用同一实现
 * （此前两处各写一份，TopBar 那份还漏了主题切换入口）。
 * P4 大屏桌面化：导航收进分段控件容器并配图标、页头加高到 56px、
 * 左右内边距随视口生长，副标题在窄屏隐藏（见 layout.css .app-header-brand-tag）。
 */
export default function AppHeader({ active, actions }: AppHeaderProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const can = usePermission();
  const mode = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);

  const items = NAV.filter((n) => !n.adminOnly || can(PERMISSIONS.USER_MANAGE));

  return (
    <header className="app-header">
      <div className="app-header-brand">
        <BrandMark size={24} />
        <span className="app-header-brand-name">ArchView</span>
        <span className="app-header-brand-tag muted">建筑与室内设计三维建模</span>
      </div>

      <nav className="app-header-nav" aria-label="主导航">
        {items.map((n) => (
          <Link
            key={n.key}
            to={n.to}
            className={'app-header-link' + (active === n.key ? ' active' : '')}
            aria-current={active === n.key ? 'page' : undefined}
          >
            <Icon name={n.icon} size={15} />
            {n.label}
          </Link>
        ))}
      </nav>

      <div className="app-header-right">
        {actions}
        <UserMenu
          user={user}
          canManageUsers={can(PERMISSIONS.USER_MANAGE)}
          theme={{ dark: mode === 'dark', onToggle: toggleTheme }}
          onNavigate={(to) => navigate(to)}
          onLogout={() => void logout().then(() => navigate('/login', { replace: true }))}
          avatarClassName="avatar avatar-sm"
        />
      </div>
    </header>
  );
}
