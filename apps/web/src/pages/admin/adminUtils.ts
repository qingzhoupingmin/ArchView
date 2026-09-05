import type { IconName } from '@archview/ui';

/** 管理中心三个页签（P4：系统设置 / 操作日志在 P3 接入 T6.7 / T6.8） */
export type UserTab = 'users' | 'settings' | 'logs';

/** 每页条数（P1：用户量上来后不再全量渲染表格） */
export const PAGE_SIZE = 20;

/** P4：侧栏菜单收进数组并配图标准，避免三处几乎重复的 JSX */
export const SIDE_ITEMS: { key: UserTab; label: string; icon: IconName; soon?: string }[] = [
  { key: 'users', label: '用户管理', icon: 'users' },
  { key: 'settings', label: '系统设置', icon: 'settings', soon: '即将上线' },
  { key: 'logs', label: '操作日志', icon: 'logs' },
];

/** 列表里的时间列：无效值一律显示破折号，不给 Invalid Date */
export function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
