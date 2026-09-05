/**
 * 共享资源工厂单测（素材 L3 专项，开发计划 v3.8）：
 * ① **面数漂移守卫**——`geometryOf` 实际生成的三角面数必须与 core
 *    `primTriangleCount` 的口径逐一对应（分段参数在 assets.ts 改动的当条先红，
 *    免得组件库闸门的面数预算与真实几何悄悄脱钩）；
 * ② 几何缓存的跨实例共享与 dispose 收口（T2.10f 老约定的回归防线）。
 * 零 DOM / 零 WebGL：BufferGeometry 都是纯 JS 数据（与 instancing.test.ts 同套路）。
 */
import { describe, expect, it } from 'vitest';
import type { GeometryPrimitive } from '@archview/core';
import { primTriangleCount } from '@archview/core';
import { AssetRegistry } from './assets';

/** 五种图元的代表样本（尺寸取整，只为过缓存键） */
const SAMPLES: { label: string; prim: GeometryPrimitive }[] = [
  { label: 'box', prim: { kind: 'box', size: [600, 2000, 1000], offset: { x: 0, y: 1000, z: 0 } } },
  { label: 'cylinder', prim: { kind: 'cylinder', size: [75, 480], offset: { x: 0, y: 240, z: 0 } } },
  { label: 'plane', prim: { kind: 'plane', size: [600, 600], offset: { x: 0, y: 0, z: 0 } } },
  { label: 'sphere', prim: { kind: 'sphere', size: [120], offset: { x: 0, y: 120, z: 0 } } },
  { label: 'cone', prim: { kind: 'cone', size: [40, 90], offset: { x: 0, y: 45, z: 0 } } },
];

describe('geometryOf 的面数与 core primTriangleCount 同源（L3 面数预算的守卫）', () => {
  for (const { label, prim } of SAMPLES) {
    it(`${label} 的三角面数 = primTriangleCount（分段参数漂移即红）`, () => {
      const registry = new AssetRegistry();
      const geo = registry.geometryOf(prim);
      const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      expect(tris, `${label} 实际 ${tris} 面 ≠ 口径 ${primTriangleCount(prim)} 面`).toBe(
        primTriangleCount(prim),
      );
      registry.dispose();
    });
  }
});

describe('几何缓存：同 kind 同尺寸跨实例共享，dispose 统一回收', () => {
  it('同规格图元取到同一份 BufferGeometry（跨实例共享）', () => {
    const registry = new AssetRegistry();
    const a: GeometryPrimitive = { kind: 'sphere', size: [120], offset: { x: 0, y: 120, z: 0 } };
    const b: GeometryPrimitive = { kind: 'sphere', size: [120], offset: { x: 900, y: 120, z: 0 } };
    expect(registry.geometryOf(a)).toBe(registry.geometryOf(b));
    registry.dispose();
  });

  it('不同规格不串号（sphere 与同数字的 cone / box 各自独立）', () => {
    const registry = new AssetRegistry();
    const sphere: GeometryPrimitive = { kind: 'sphere', size: [120], offset: { x: 0, y: 120, z: 0 } };
    const cone: GeometryPrimitive = { kind: 'cone', size: [120, 120], offset: { x: 0, y: 60, z: 0 } };
    const box: GeometryPrimitive = { kind: 'box', size: [120, 120, 120], offset: { x: 0, y: 60, z: 0 } };
    const geos = new Set([registry.geometryOf(sphere), registry.geometryOf(cone), registry.geometryOf(box)]);
    expect(geos.size).toBe(3);
    registry.dispose();
  });

  it('dispose 后缓存清空（视口销毁统一回收，T2.10f）', () => {
    const registry = new AssetRegistry();
    const prim: GeometryPrimitive = { kind: 'cone', size: [40, 90], offset: { x: 0, y: 45, z: 0 } };
    const before = registry.geometryOf(prim);
    expect(before.dispose).toBeDefined();
    registry.dispose();
    const after = registry.geometryOf(prim);
    expect(after).not.toBe(before);
    registry.dispose();
  });
});