import { describe, expect, it } from 'vitest';
import { snapToGrid } from './grid';

/**
 * 网格吸附纯函数单测（FR-M04 / T2.2）：
 * 默认 600mm 模数（架空地板砖边长），300 / 600 / 1200 可配（开发计划 §4.2 T2.2）。
 */
describe('snapToGrid（FR-M04）', () => {
  it('600mm 模数：吸附到最近格点', () => {
    expect(snapToGrid(0, 600)).toBe(0);
    expect(snapToGrid(599, 600)).toBe(600);
    expect(snapToGrid(600, 600)).toBe(600);
    expect(snapToGrid(601, 600)).toBe(600);
    expect(snapToGrid(1199, 600)).toBe(1200);
    expect(snapToGrid(2000, 600)).toBe(1800); // 2000/600≈3.33 → 3 格 = 1800
  });

  it('半格点向上取整（Math.round 语义）', () => {
    expect(snapToGrid(300, 600)).toBe(600);
    expect(snapToGrid(150, 300)).toBe(300);
    expect(snapToGrid(600, 1200)).toBe(1200);
  });

  it('300 / 1200mm 模数（状态栏步长循环表）', () => {
    expect(snapToGrid(100, 300)).toBe(0);
    expect(snapToGrid(250, 300)).toBe(300);
    expect(snapToGrid(450, 300)).toBe(600);
    expect(snapToGrid(599, 1200)).toBe(0);
    expect(snapToGrid(1800, 1200)).toBe(2400); // 1.5 格 → 向上取 2 格
  });

  it('负坐标（机房原点可位于模型负向）', () => {
    expect(snapToGrid(-301, 600)).toBe(-600);
    expect(snapToGrid(-299, 600)).toBe(0); // -0 已归一化为 0
    expect(snapToGrid(-1800, 600)).toBe(-1800);
  });

  it('浮点坐标（地面射线求交结果为浮点）', () => {
    expect(snapToGrid(599.6, 600)).toBe(600);
    expect(snapToGrid(1199.9, 600)).toBe(1200);
    expect(snapToGrid(-0.4, 600)).toBe(0);
  });

  it('防御：step ≤ 0 时按 1mm 处理（避免除零 / 负模数）', () => {
    expect(snapToGrid(100.4, 0)).toBe(100);
    expect(snapToGrid(100.4, -600)).toBe(100);
  });
});
