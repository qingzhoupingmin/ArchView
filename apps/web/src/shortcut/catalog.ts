/**
 * 快捷键表（Phase 6 自 shortcuts.ts 分离）——**纯数据，不含行为**。
 *
 * 建模页 ShortcutHelpDialog 与工程列表页指南卡都渲染这里，增删快捷键只改这一处；
 * 键位与动作的对应关系由 ./parse.ts 负责，实际执行由 ./dispatch.ts 负责。
 */

/** 快捷键 ID（语义动作，与 handleShortcut 的分发一一对应） */
export type ShortcutId =
  | 'undo'
  | 'redo'
  | 'save'
  | 'copy'
  | 'paste'
  | 'cut'
  | 'duplicate'
  | 'delete'
  | 'select-all'
  | 'focus-selection'
  | 'view-2d-3d'
  | 'panel-left'
  | 'panel-right'
  | 'snap-toggle'
  | 'lod-toggle'
  | 'reset-view'
  | 'preset-top'
  | 'preset-front'
  | 'preset-side'
  | 'preset-iso'
  | 'help'
  | 'escape';

/** 单条快捷键（keys 为按键顺序，帮助弹窗渲染为 <kbd>） */
export interface ShortcutEntry {
  keys: string[];
  label: string;
}

/** 快捷键分组（帮助弹窗的一个小节） */
export interface ShortcutGroup {
  title: string;
  entries: ShortcutEntry[];
}

/**
 * 快捷键表（T2.7 / §10.3 单一事实源）：
 * 建模页 ShortcutHelpDialog 与工程列表页指南卡均渲染本表，增删快捷键只改这一处。
 */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: '选择与编辑',
    entries: [
      { keys: ['Ctrl', 'A'], label: '全选（单键 A 已让位 WASD 移动画布）' },
      { keys: ['F'], label: '聚焦选中' },
      { keys: ['Delete'], label: '删除选中（支持多选 / 房间）' },
      { keys: ['Esc'], label: '取消选择 / 关闭弹窗' },
      { keys: ['Ctrl', 'C'], label: '复制（支持多选）' },
      { keys: ['Ctrl', 'V'], label: '粘贴' },
      { keys: ['Ctrl', 'X'], label: '剪切（支持多选）' },
      { keys: ['Ctrl', 'D'], label: '复制组件（支持多选）' },
      { keys: ['Ctrl', 'Z'], label: '撤销' },
      { keys: ['Ctrl', 'Shift', 'Z'], label: '重做（也可 Ctrl+Y）' },
      { keys: ['Ctrl', 'S'], label: '手动保存' },
    ],
  },
  {
    title: '视图',
    entries: [
      { keys: ['Tab'], label: '2D / 3D 视图切换' },
      { keys: ['W', 'A', 'S', 'D'], label: '移动画布（Shift 2× 加速，2D / 3D 均可用）' },
      { keys: ['1'], label: '顶视图' },
      { keys: ['2'], label: '正视图' },
      { keys: ['3'], label: '侧视图' },
      { keys: ['4'], label: '等轴视图' },
      { keys: ['R'], label: '重置机位（2D = 重新取景）' },
      { keys: ['G'], label: '网格吸附开关（步长 300 / 600 / 1200mm）' },
      { keys: ['L'], label: '素材细节档循环：自动（按相机距离）→ 近档 → 远档' },
    ],
  },
  {
    title: '面板与帮助',
    entries: [
      { keys: ['B'], label: '收起 / 展开组件库面板' },
      { keys: ['I'], label: '收起 / 展开属性 / 统计面板' },
      { keys: ['?'], label: '快捷键帮助（本弹窗）' },
    ],
  },
];

/** 鼠标操作范式（产品文档 §10.3「交互范式」，帮助弹窗一并展示；交互范式改版：左选 / 中转 / 右详情 / WASD 平移） */
export const MOUSE_GROUPS: { title: string; entries: string[] }[] = [
  {
    title: '3D 视口',
    entries: [
      '左键选择 · Ctrl+单击多选 · 双击聚焦 · 拖组件直接移动',
      '中键拖拽旋转',
      '右键查看详情（组件 / 房间 / 视图操作）',
      'WASD 移动画布（Shift 2× 加速）· Ctrl+左键拖拽平移（无中键触屏板）',
      '滚轮缩放（以光标为中心）',
    ],
  },
  {
    title: '2D 视图',
    entries: [
      '左键选择 / 拖拽（整个选择集一起移动）',
      'Shift+左键框选',
      '中键拖拽平移 · WASD 移动平面图',
      '右键查看详情菜单（重置机位 / 定位选中）· 拖拽平移',
      '滚轮缩放',
    ],
  },
];
