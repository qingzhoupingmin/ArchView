/**
 * 快捷键纯函数单测（T2.7 / §10.3）：
 * parseShortcut = 「键位组合 → 快捷键 ID」的纯解析（产品文档 §10.3 快捷键表为基准），
 * 覆盖：撤销重做区分 / 编辑组 / 选择与视图 / 面板 / 1·2·3·4 预设 / ? 帮助 / 放行规则（Alt、Ctrl 未知键）。
 */
import { describe, expect, it } from 'vitest';
import { parseShortcut, SHORTCUT_GROUPS, type ShortcutId } from './index';

/** 构造最小键位事件（只带 parseShortcut 读取的字段） */
function ev(partial: { key: string } & Partial<{ ctrlKey: boolean; shiftKey: boolean; metaKey: boolean; altKey: boolean }>): Parameters<typeof parseShortcut>[0] {
  return {
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    altKey: false,
    ...partial,
  };
}

describe('parseShortcut（T2.7 / §10.3）', () => {
  it('撤销 / 重做：Ctrl+Z 撤销，Ctrl+Shift+Z 与 Ctrl+Y 重做（Cmd 同义）', () => {
    expect(parseShortcut(ev({ key: 'z', ctrlKey: true }))).toBe('undo');
    expect(parseShortcut(ev({ key: 'z', ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(parseShortcut(ev({ key: 'Z', metaKey: true, shiftKey: true }))).toBe('redo');
    expect(parseShortcut(ev({ key: 'z', metaKey: true }))).toBe('undo');
    expect(parseShortcut(ev({ key: 'y', ctrlKey: true }))).toBe('redo');
  });

  it('编辑组：复制 / 粘贴 / 剪切 / 快速复制 / 手动保存', () => {
    expect(parseShortcut(ev({ key: 'c', ctrlKey: true }))).toBe('copy');
    expect(parseShortcut(ev({ key: 'v', ctrlKey: true }))).toBe('paste');
    expect(parseShortcut(ev({ key: 'x', ctrlKey: true }))).toBe('cut');
    expect(parseShortcut(ev({ key: 'd', ctrlKey: true }))).toBe('duplicate');
    expect(parseShortcut(ev({ key: 's', ctrlKey: true }))).toBe('save');
  });

  it('选择 / 视图 / 面板单键', () => {
    // 交互范式改版：单键 A 让位 WASD 移动画布（renderer 层），全选改走 Ctrl+A（大小写不敏感）
    expect(parseShortcut(ev({ key: 'a' }))).toBeNull();
    expect(parseShortcut(ev({ key: 'A', shiftKey: true }))).toBeNull();
    expect(parseShortcut(ev({ key: 'a', ctrlKey: true }))).toBe('select-all');
    expect(parseShortcut(ev({ key: 'A', metaKey: true }))).toBe('select-all'); // 大小写不敏感
    expect(parseShortcut(ev({ key: 'f' }))).toBe('focus-selection');
    expect(parseShortcut(ev({ key: 'Delete' }))).toBe('delete');
    expect(parseShortcut(ev({ key: 'Backspace' }))).toBe('delete');
    expect(parseShortcut(ev({ key: 'Escape' }))).toBe('escape');
    expect(parseShortcut(ev({ key: 'Tab' }))).toBe('view-2d-3d');
    expect(parseShortcut(ev({ key: 'b' }))).toBe('panel-left');
    expect(parseShortcut(ev({ key: 'i' }))).toBe('panel-right');
    expect(parseShortcut(ev({ key: 'g' }))).toBe('snap-toggle');
    expect(parseShortcut(ev({ key: 'r' }))).toBe('reset-view');
  });

  it('1 / 2 / 3 / 4 = 顶 / 前 / 侧 / 等轴（§10.3 表序）', () => {
    expect(parseShortcut(ev({ key: '1' }))).toBe('preset-top');
    expect(parseShortcut(ev({ key: '2' }))).toBe('preset-front');
    expect(parseShortcut(ev({ key: '3' }))).toBe('preset-side');
    expect(parseShortcut(ev({ key: '4' }))).toBe('preset-iso');
  });

  it('帮助与放行规则', () => {
    expect(parseShortcut(ev({ key: '?', shiftKey: true }))).toBe('help');
    // 未映射键放行给浏览器 / 页面
    expect(parseShortcut(ev({ key: 'm' }))).toBeNull();
    expect(parseShortcut(ev({ key: 'w' }))).toBeNull(); // WASD 移动画布由 renderer 层处理
    // Alt 按住一律跳过（浏览器菜单 / 输入法快捷键）
    expect(parseShortcut(ev({ key: 'a', altKey: true }))).toBeNull();
    expect(parseShortcut(ev({ key: 'z', ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('帮助表完整（SHORTCUT_GROUPS：每组合有键名与说明，覆盖 §10.3 全部快捷键）', () => {
    const allKeys = SHORTCUT_GROUPS.flatMap((g) => g.entries).flatMap((e) => e.keys);
    // §10.3 表中的每个快捷键键名都应在帮助表出现
    for (const expected of ['A', 'W', 'F', 'Delete', 'Esc', 'Ctrl', 'Tab', 'B', 'I', 'G', 'R', '1', '2', '3', '4', '?']) {
      expect(allKeys, `帮助表缺少键名 ${expected}`).toContain(expected);
    }
    for (const group of SHORTCUT_GROUPS) {
      expect(group.title).toBeTruthy();
      for (const entry of group.entries) {
        expect(entry.keys.length).toBeGreaterThan(0);
        expect(entry.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('所有解析结果都是合法 ShortcutId（无拼写漂移）', () => {
    const ids: ShortcutId[] = [
      'undo', 'redo', 'save', 'copy', 'paste', 'cut', 'duplicate', 'delete',
      'select-all', 'focus-selection', 'view-2d-3d', 'panel-left', 'panel-right',
      'snap-toggle', 'reset-view', 'preset-top', 'preset-front', 'preset-side',
      'preset-iso', 'help', 'escape',
    ];
    const results = [
      parseShortcut(ev({ key: 'z', ctrlKey: true })),
      parseShortcut(ev({ key: 'z', ctrlKey: true, shiftKey: true })),
      parseShortcut(ev({ key: 's', ctrlKey: true })),
      parseShortcut(ev({ key: 'c', ctrlKey: true })),
      parseShortcut(ev({ key: 'v', ctrlKey: true })),
      parseShortcut(ev({ key: 'x', ctrlKey: true })),
      parseShortcut(ev({ key: 'd', ctrlKey: true })),
      parseShortcut(ev({ key: 'Delete' })),
      parseShortcut(ev({ key: 'a', ctrlKey: true })),
      parseShortcut(ev({ key: 'f' })),
      parseShortcut(ev({ key: 'Tab' })),
      parseShortcut(ev({ key: 'b' })),
      parseShortcut(ev({ key: 'i' })),
      parseShortcut(ev({ key: 'g' })),
      parseShortcut(ev({ key: 'r' })),
      parseShortcut(ev({ key: '1' })),
      parseShortcut(ev({ key: '2' })),
      parseShortcut(ev({ key: '3' })),
      parseShortcut(ev({ key: '4' })),
      parseShortcut(ev({ key: '?' })),
      parseShortcut(ev({ key: 'Escape' })),
    ];
    for (const r of results) {
      expect(ids).toContain(r);
    }
  });
});