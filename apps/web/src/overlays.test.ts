/**
 * 浮层注册表单测（T2.7 / §10.3 Esc 语义统一）：
 * 引用计数——多个浮层叠加打开时全部关闭才放行 Esc 清选择；多余注销不计负。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hasOverlay, registerOverlay, unregisterOverlay } from './overlays';

describe('overlays（T2.7 Esc 语义）', () => {
  afterEach(() => {
    while (hasOverlay()) unregisterOverlay();
  });

  it('注册 / 注销引用计数', () => {
    expect(hasOverlay()).toBe(false);
    registerOverlay();
    expect(hasOverlay()).toBe(true);
    registerOverlay(); // 两个浮层叠加（极端：右键菜单 + 弹窗）
    expect(hasOverlay()).toBe(true);
    unregisterOverlay();
    expect(hasOverlay()).toBe(true); // 还有一个开着，Esc 仍让位
    unregisterOverlay();
    expect(hasOverlay()).toBe(false);
  });

  it('多余注销不计负（卸载顺序异常也不至于永远挡 Esc）', () => {
    unregisterOverlay();
    expect(hasOverlay()).toBe(false);
    registerOverlay();
    unregisterOverlay();
    unregisterOverlay();
    expect(hasOverlay()).toBe(false);
  });
});