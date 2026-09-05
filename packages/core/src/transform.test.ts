import { describe, expect, it } from 'vitest';
import {
  buildRectArray,
  createComponent,
  defaultArraySpacing,
  mirrorComponent,
  normalizeDegrees,
  snapAngle,
  yawDegrees,
  yawQuaternion,
  type Component,
  type ComponentType,
} from './index';

const rackType: ComponentType = {
  id: 't-rack42',
  name: '42U 服务器机柜',
  category: 'it',
  defaultSize: { w: 600, d: 1000, h: 2000 },
  geometry: [{ kind: 'box', size: [600, 2000, 1000], offset: { x: 0, y: 1000, z: 0 } }],
  defaultAttrs: { ratedPowerW: 8000 },
  uSlots: 42,
};

function makeRack(pos: { x: number; y: number; z: number } = { x: 1200, y: 0, z: 1200 }): Component {
  return createComponent(rackType, pos);
}

describe('变换纯函数（T2.3 / FR-M05 / M06）', () => {
  it('yawQuaternion / yawDegrees 往返换算（FR-M06）', () => {
    for (const deg of [0, 45, 90, 180, 270, 330, 359]) {
      expect(yawDegrees(yawQuaternion(deg))).toBeCloseTo(deg, 6);
    }
    // 身份四元数 = 0°
    expect(yawDegrees({ x: 0, y: 0, z: 0, w: 1 })).toBe(0);
  });

  it('snapAngle 90° 步进吸附（FR-M06 手柄约定）', () => {
    expect(snapAngle(89)).toBe(90);
    expect(snapAngle(91)).toBe(90);
    expect(snapAngle(135)).toBe(180); // Math.round 语义：135/90=1.5 → 2
    expect(snapAngle(-5)).toBe(0); // 距 0° 最近
    expect(snapAngle(-95)).toBe(270); // -95 → -90 → 270
    expect(snapAngle(359)).toBe(0);
    expect(snapAngle(45, 45)).toBe(45);
  });

  it('normalizeDegrees：任意角度归一化到 [0, 360)（FR-M03 / T2.5 属性面板）', () => {
    expect(normalizeDegrees(0)).toBe(0);
    expect(normalizeDegrees(45)).toBe(45);
    expect(normalizeDegrees(359.5)).toBe(359.5);
    expect(normalizeDegrees(360)).toBe(0);
    expect(normalizeDegrees(720)).toBe(0);
    expect(normalizeDegrees(-45)).toBe(315);
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(-360)).toBe(0);
  });

  it('矩形阵列：行×列数量与位置（第一格锚定原件，+X 列 / +Z 行）（FR-M05）', () => {
    const base = makeRack();
    const comps = buildRectArray(base, { rows: 2, cols: 3, dx: 1200, dz: 2200 });
    expect(comps).toHaveLength(6);
    // 第一格 = 基准组件当前位置
    expect(comps[0].position).toEqual({ x: 1200, y: 0, z: 1200 });
    // 列方向 +X（同行内）
    expect(comps[1].position.x).toBe(base.position.x + 1200);
    expect(comps[2].position.x).toBe(base.position.x + 2400);
    expect(comps[1].position.z).toBe(base.position.z);
    // 行方向 +Z（第二行从第 0 列重新展开）
    expect(comps[3].position).toEqual({ x: base.position.x, y: 0, z: base.position.z + 2200 });
    expect(comps[5].position).toEqual({
      x: base.position.x + 2400,
      y: 0,
      z: base.position.z + 2200,
    });
    // 每格独立新 id；scale 恒 (1,1,1)（size 单一事实源，§8.2-9）；其余字段完整继承
    const ids = new Set(comps.map((c) => c.id));
    expect(ids.size).toBe(6);
    for (const c of comps) {
      expect(c.scale).toEqual({ x: 1, y: 1, z: 1 });
      expect(c.name).toBe(base.name);
      expect(c.typeId).toBe(base.typeId);
      expect(c.size).toEqual(base.size);
    }
  });

  it('矩形阵列：逐格网格吸附（FR-M04）', () => {
    const base = makeRack({ x: 1000, y: 0, z: 1000 });
    const comps = buildRectArray(base, { rows: 1, cols: 2, dx: 1000, dz: 0, snapStep: 600 });
    // 1000 → 1200；2000 → 1800（Math.round(2000/600)=3）
    expect(comps[0].position.x).toBe(1200);
    expect(comps[1].position.x).toBe(1800);
    expect(comps[0].position.z).toBe(1200);
  });

  it('矩形阵列：默认间距 = 黄金样例约定（列距 w+600 / 行距 d+1200）', () => {
    expect(defaultArraySpacing({ w: 600, d: 1000, h: 2000 })).toEqual({ dx: 1200, dz: 2200 });
  });

  it('镜像复制：yz 平面（x → -x，偏航取反，新 id，原件不变）（FR-M05）', () => {
    const base = makeRack({ x: 1200, y: 0, z: 2000 });
    base.rotation = yawQuaternion(90);
    const m = mirrorComponent(base, 'yz');
    expect(m.id).not.toBe(base.id);
    expect(m.position).toEqual({ x: -1200, y: 0, z: 2000 });
    expect(yawDegrees(m.rotation)).toBeCloseTo(270, 6);
    expect(m.name).toBe(base.name);
    // 原件不受影响（深拷贝）
    expect(base.position.x).toBe(1200);
    expect(yawDegrees(base.rotation)).toBeCloseTo(90, 6);
  });

  it('镜像复制：xz 平面（z → -z）', () => {
    const base = makeRack({ x: 1200, y: 0, z: 2000 });
    const m = mirrorComponent(base, 'xz');
    expect(m.position).toEqual({ x: 1200, y: 0, z: -2000 });
  });

  it('镜像复制：0° 组件镜像后仍为 0°（-0 归一化）', () => {
    const m = mirrorComponent(makeRack());
    expect(yawDegrees(m.rotation)).toBe(0);
  });
});