import { type ReactNode } from 'react';
import { Svg } from './svg';

/**
 * 统一图标层（P3 阶段 C）。规格与无障碍语义见 ./svg.tsx。
 *
 * 为什么要收口：此前项目里同时存在三套「图标」——
 *  ① 手写内联 SVG（TopBar 的撤销 / 重做 / 面板 / 导出、LoginPage 的眼睛）；
 *  ② Unicode 字符（视口预设「轴顶正侧」、重置 ⟲、面板把手 › ‹、空态 ▦、弹窗关闭 ×、
 *     组件库兜底 ▣）——这些字符在不同字体下的宽度 / 基线 / 有无字形全凭运气；
 *  ③ emoji（组件库 53 个组件的 icon 字段）——Windows / macOS / Linux 三平台渲染完全不同，
 *     且无法跟随主题色，深色模式下是一堆改不掉的彩色块。
 * 三者统一为同 viewBox / 同线宽 / 同端点的描边 SVG，颜色一律 currentColor，
 * 图标于是能跟着 --color-text-muted / --color-primary 走主题了。
 */

/** 图标名联合：新增图形必须同时加到这里，拼错字符串会在编译期报错而非静默不出图 */
export type IconName =
  /* 顶栏动作 */
  | 'undo'
  | 'redo'
  | 'export'
  /* 面板开合：空心 = 已展开，实心侧栏 = 已收起（仅靠 aria-pressed 上色不足以区分） */
  | 'panel-left'
  | 'panel-left-closed'
  | 'panel-right'
  | 'panel-right-closed'
  /* 表单 */
  | 'eye'
  | 'eye-off'
  | 'close'
  /* 建模（T2.8） */
  | 'room'
  /* 视口预设与工具 */
  | 'view-iso'
  | 'view-top'
  | 'view-front'
  | 'view-side'
  | 'view-reset'
  /* 折叠把手 */
  | 'chevron-left'
  | 'chevron-right'
  /* 空态 / 占位 */
  | 'cube'
  /* P4 大屏桌面化：页面层新增（导航 · KPI · 页签 · 元信息），
     规格与上面完全一致（24 viewBox · 1.8 描边 · currentColor），不加填充色，
     因此暗色模式下能一起跟随 --color-text-muted / --color-primary。 */
  | 'search'
  | 'plus'
  | 'user'
  | 'users'
  | 'settings'
  | 'logs'
  | 'shield'
  | 'check'
  | 'ban'
  | 'clock'
  | 'mail'
  | 'lock'
  | 'palette'
  | 'keyboard'
  | 'sync'
  | 'layers'
  | 'folder';

/** 等轴立方体：'view-iso'（切等轴视图）与 'cube'（空态占位）语义不同但同形，共用一份 path */
const CUBE = (
  <>
    <path d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3Z" />
    <path d="M4 7.5 12 12l8-4.5" />
    <path d="M12 12v9" />
  </>
);

/** 对外图标名 → 图形。键即 IconName（kebab-case），不再多一层映射表。 */
const GLYPHS: Record<IconName, ReactNode> = {
  /* 顶栏动作 */
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </>
  ),
  redo: (
    <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9a5 5 0 0 0 0 10h3" />
    </>
  ),
  export: (
    <>
      <path d="M12 3v11" />
      <path d="m8 7 4-4 4 4" />
      <path d="M5 20h14" />
    </>
  ),
  'panel-left': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>
  ),
  /* 收起态：左半填实，一眼看出「这一侧没了」 */
  'panel-left-closed': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <rect x="4" y="5" width="4.5" height="14" rx="1" fill="currentColor" stroke="none" />
      <path d="M9 4v16" />
    </>
  ),
  'panel-right': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </>
  ),
  'panel-right-closed': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <rect x="15.5" y="5" width="4.5" height="14" rx="1" fill="currentColor" stroke="none" />
      <path d="M15 4v16" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
      <path d="M4 4l16 16" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  /* 房间（T2.8）：楼层平面——外框 + L 形隔墙，一眼读出「这是空间」 */
  room: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 13h9" />
      <path d="M12 13v8" />
    </>
  ),
  /* 等轴测：立方体三线交汇 */
  'view-iso': CUBE,
  /* 顶视：矩形 + 十字定位 */
  'view-top': (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M12 4v16" />
      <path d="M4 12h16" />
    </>
  ),
  /* 正视：立面 + 地平线 */
  'view-front': (
    <>
      <rect x="5" y="7" width="14" height="10" rx="1.5" />
      <path d="M3 20h18" />
    </>
  ),
  /* 侧视：L 形体量，与正视区分 */
  'view-side': (
    <>
      <path d="M6 17V8h6v9" />
      <path d="M12 12h6v5" />
      <path d="M3 20h18" />
    </>
  ),
  'view-reset': (
    <>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v4h-4" />
    </>
  ),
  'chevron-left': <path d="m14 6-6 6 6 6" />,
  'chevron-right': <path d="m10 6 6 6-6 6" />,
  /* 空态 / 工程占位 */
  cube: CUBE,
  /* ---------- P4 大屏桌面化新增 ---------- */
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 19.5a7 7 0 0 1 14 0" />
    </>
  ),
  users: (
    <>
      <circle cx="9.5" cy="8" r="3.4" />
      <path d="M3.5 19.5a6 6 0 0 1 12 0" />
      <path d="M16.5 5.4a3.4 3.4 0 0 1 0 5.2" />
      <path d="M18 14.2a6 6 0 0 1 2.8 5.3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3" />
      <path d="m6 6 1.7 1.7M16.3 16.3 18 18M18 6l-1.7 1.7M7.7 16.3 6 18" />
    </>
  ),
  logs: (
    <>
      <rect x="4.5" y="4" width="15" height="16" rx="2" />
      <path d="M8 8.5h8M8 12h8M8 15.5h4.5" />
    </>
  ),
  shield: <path d="M12 3.5 19 6v6.1c0 3.7-2.8 6.7-7 8.4-4.2-1.7-7-4.7-7-8.4V6l7-2.5Z" />,
  check: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.2 12.3 2.6 2.6 5-5.3" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 18 18 6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.3 2.1" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  palette: (
    <>
      <path d="M12 20.4a8.4 8.4 0 1 1 8.4-8.4c0 2.3-1.8 3.4-3.7 3.4h-1.5a2 2 0 0 0-1.5 3.3c.6.7.1 1.7-.8 1.7Z" />
      <path d="M8.2 10.2h.01M11.6 7.6h.01M15.4 9.6h.01" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.8" y="6.5" width="18.4" height="11" rx="2" />
      <path d="M6.6 10h.01M10 10h.01M13.4 10h.01M16.8 10h.01M6.6 13.4h.01M17.4 13.4h.01M10 13.4h4" />
    </>
  ),
  /* 云 + 上箭头：表达「自动同步到服务端」，比软盘更贴合 30s 轮询保存的实际行为 */
  sync: (
    <>
      <path d="M7.5 18.5h9.3a3.7 3.7 0 0 0 .5-7.37 5.5 5.5 0 0 0-10.5-1.3A4 4 0 0 0 7.5 18.5Z" />
      <path d="M12 11v5.6M9.9 14.4 12 16.5l2.1-2.1" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.5 8.5 4.3L12 12 3.5 7.8 12 3.5Z" />
      <path d="m3.5 12.1 8.5 4.3 8.5-4.3" />
      <path d="m3.5 16.3 8.5 4.2 8.5-4.2" />
    </>
  ),
  folder: (
    <path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h3.6l1.8 2.1H19A1.5 1.5 0 0 1 20.5 9.1v8.4A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5V7Z" />
  ),
};

export interface IconProps {
  name: IconName;
  /** 像素边长，默认 16（顶栏 / 状态栏 15，表单 16–18） */
  size?: number;
  className?: string;
  /** 无障碍名称，默认不带；细则见 svg.tsx 的 SvgProps.label */
  label?: string;
}

/** 按名字取描边图标。未登记的 name 在编译期即报错。 */
export function Icon({ name, size, className, label }: IconProps) {
  return (
    <Svg size={size} className={className} label={label}>
      {GLYPHS[name]}
    </Svg>
  );
}
