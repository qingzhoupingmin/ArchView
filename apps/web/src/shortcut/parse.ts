import type { ViewPreset } from '@archview/renderer';
import type { ShortcutId } from './catalog';

/**
 * 键位解析（纯函数，自 shortcuts.ts 分离）：只回答「这一下按的是哪个动作」，
 * 不碰 store、不碰 DOM，因此 shortcuts.test.ts 能在 node 环境里穷举组合。
 */

/** Ctrl / Cmd 组合键 → 快捷键（Ctrl+Z 的 shift 区分在 parseShortcut 内处理） */
const MOD_KEYS: Record<string, ShortcutId> = {
  y: 'redo',
  a: 'select-all', // 交互范式改版：单键 A 释放给 WASD 移动画布（renderer 层），全选走 Ctrl+A（业界惯例）
  s: 'save',
  c: 'copy',
  v: 'paste',
  x: 'cut',
  d: 'duplicate',
};

/**
 * 键位组合 → 快捷键 ID（纯函数，可单测）。
 * 约定：
 * - Alt 按住 → null（浏览器菜单 / 输入法快捷键，避免冲突）；
 * - Ctrl / Cmd 组合只处理 z 与 MOD_KEYS，其余放行给浏览器（Ctrl+W 关页等）；
 * - '?' = Shift + '/'（常见布局），直接按 e.key 判定；
 * - 字母大小写不敏感（Shift+A 仍算 A）。
 */
export function parseShortcut(e: {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): ShortcutId | null {
  if (e.altKey) return null;
  const key = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
    return MOD_KEYS[key] ?? null;
  }
  switch (key) {
    case 'delete':
    case 'backspace':
      return 'delete';
    case 'escape':
      return 'escape';
    case 'tab':
      return 'view-2d-3d';
    case 'f':
      return 'focus-selection';
    case 'b':
      return 'panel-left';
    case 'i':
      return 'panel-right';
    case 'g':
      return 'snap-toggle';
    case 'r':
      return 'reset-view';
    case 'l':
      return 'lod-toggle'; // T2.12：素材细节档（自动 → 近档 → 远档）循环
    case '1':
      return 'preset-top';
    case '2':
      return 'preset-front';
    case '3':
      return 'preset-side';
    case '4':
      return 'preset-iso';
    default:
      return e.key === '?' ? 'help' : null;
  }
}

/** 1 / 2 / 3 / 4 → 视图预设（产品文档 §10.3 表序：顶 / 前 / 侧 / 等轴） */
export function presetOf(id: ShortcutId): ViewPreset | null {
  switch (id) {
    case 'preset-top':
      return 'top';
    case 'preset-front':
      return 'front';
    case 'preset-side':
      return 'side';
    case 'preset-iso':
      return 'iso';
    default:
      return null;
  }
}
