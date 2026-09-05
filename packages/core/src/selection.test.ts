import { describe, expect, it } from 'vitest';
import { yawQuaternion } from './transform';
import { footprintAABB, rect2D, rectsIntersect, rubberBandSelect } from './selection';

/**
 * 2D 框选纯函数单测（T2.6 / T2.4 遗留 / FR-M07 / FR-V02）：
 * 占地 AABB（含 Y 轴偏航）+ 矩形相交 + 框选命中（开发计划 §4.2 T2.6）。
 */

/** 构造测试组件（最小字段集：位置 / 偏航 / 尺寸） */
const comp = (id: string, x: number, z: number, deg: number, w: number, d: number) => ({
  id,
  position: { x, y: 0, z },
  rotation: yawQuaternion(deg),
  size: { w, d, h: 2000 },
});

describe('rect2D（FR-V02）', () => {
  it('两角点顺序任意，输出归一化 min/max', () => {
    expect(rect2D(10, 20, 30, 40)).toEqual({ xMin: 10, zMin: 20, xMax: 30, zMax: 40 });
    expect(rect2D(30, 40, 10, 20)).toEqual({ xMin: 10, zMin: 20, xMax: 30, zMax: 40 });
  });

  it('零面积（点击未拖动）= 点矩形', () => {
    const r = rect2D(5, 5, 5, 5);
    expect(r.xMin).toBe(r.xMax);
    expect(r.zMin).toBe(r.zMax);
  });
});

describe('footprintAABB（FR-V02）', () => {
  it('未旋转：占地 = 位置 ± 半尺寸（size 单一事实源）', () => {
    const r = footprintAABB({ x: 1000, z: 2000 }, yawQuaternion(0), { w: 600, d: 1000, h: 2000 });
    expect(r).toEqual({ xMin: 700, zMin: 1500, xMax: 1300, zMax: 2500 });
  });

  it('90° 偏航：w / d 交换', () => {
    const r = footprintAABB({ x: 0, z: 0 }, yawQuaternion(90), { w: 600, d: 1000, h: 2000 });
    // cos(90°) 存在 1e-17 级浮点噪声，逐字段近似比较
    expect(r.xMin).toBeCloseTo(-500, 9);
    expect(r.zMin).toBeCloseTo(-300, 9);
    expect(r.xMax).toBeCloseTo(500, 9);
    expect(r.zMax).toBeCloseTo(300, 9);
  });

  it('270° 偏航：与 90° 等价（占地对称）', () => {
    const a = footprintAABB({ x: 0, z: 0 }, yawQuaternion(90), { w: 600, d: 1000, h: 2000 });
    const b = footprintAABB({ x: 0, z: 0 }, yawQuaternion(270), { w: 600, d: 1000, h: 2000 });
    expect(b.xMin).toBeCloseTo(a.xMin, 9);
    expect(b.xMax).toBeCloseTo(a.xMax, 9);
    expect(b.zMin).toBeCloseTo(a.zMin, 9);
    expect(b.zMax).toBeCloseTo(a.zMax, 9);
  });

  it('45° 偏航：AABB 按旋转投影扩大（|w·cosθ| + |d·sinθ|）', () => {
    const r = footprintAABB({ x: 0, z: 0 }, yawQuaternion(45), { w: 600, d: 1000, h: 2000 });
    const k = Math.SQRT1_2;
    expect(r.xMin).toBeCloseTo(-((600 + 1000) * k) / 2, 3);
    expect(r.xMax).toBeCloseTo(((600 + 1000) * k) / 2, 3);
    expect(r.zMin).toBeCloseTo(-((600 + 1000) * k) / 2, 3);
    expect(r.zMax).toBeCloseTo(((600 + 1000) * k) / 2, 3);
  });
});

describe('rectsIntersect（FR-V02）', () => {
  const a = { xMin: 0, zMin: 0, xMax: 10, zMax: 10 };

  it('重叠 = 相交', () => {
    expect(rectsIntersect(a, { xMin: 5, zMin: 5, xMax: 15, zMax: 15 })).toBe(true);
  });

  it('边相切 = 相交（橡皮筋擦边应命中）', () => {
    expect(rectsIntersect(a, { xMin: 10, zMin: 2, xMax: 20, zMax: 8 })).toBe(true);
    expect(rectsIntersect(a, { xMin: -10, zMin: 10, xMax: 5, zMax: 20 })).toBe(true);
  });

  it('分离 = 不相交；边 / 角相切 = 相交（与边相切同一放宽规则，角点接触视为命中）', () => {
    expect(rectsIntersect(a, { xMin: 11, zMin: 11, xMax: 20, zMax: 20 })).toBe(false);
    expect(rectsIntersect(a, { xMin: 10, zMin: 10, xMax: 20, zMax: 20 })).toBe(true); // 角点接触
  });
});

describe('rubberBandSelect（FR-V02 / T2.4 遗留 2D 框选）', () => {
  const items = [
    comp('c1', 0, 0, 0, 600, 600), // 占地 [-300, 300]²
    comp('c2', 2000, 0, 0, 600, 600), // 占地 [1700, 2300] × [-300, 300]
    comp('c3', 2000, 2000, 90, 1000, 600), // 90° 旋转：占地 [1550, 2450] × [1500, 2500]
  ];

  it('选中占地与选区相交的组件（输入顺序）', () => {
    expect(rubberBandSelect(items, rect2D(-1000, -1000, 2500, 1000))).toEqual(['c1', 'c2']);
  });

  it('旋转组件按旋转后占地命中（AABB 扩大不被漏选）', () => {
    // c3：90° 旋转后占地 x[1700,2300] × z[1500,2500]；原未旋转占地 x[1500,2500] × z[1700,2300]。
    // 选区取「旋转后占地内、未旋转占地外」的区域（z 1500~1600 段）：只有按旋转后 AABB 计算才能命中
    expect(rubberBandSelect(items, rect2D(1800, 1500, 1900, 1600))).toEqual(['c3']);
  });

  it('选区外组件不命中；空选区返回空数组', () => {
    expect(rubberBandSelect(items, rect2D(100000, 100000, 101000, 101000))).toEqual([]);
  });

  it('点选区（未拖动的框选）= 命中包含该点的组件', () => {
    expect(rubberBandSelect(items, rect2D(0, 0, 0, 0))).toEqual(['c1']);
  });
});
