/**
 * 矩阵纯函数单测（S2.5 / T2.10g 批渲染底座）。
 * 重点不是「算得出数」，而是**与 three.js 的列主序约定与 compose 语义逐字一致**——
 * 渲染层直接 `Matrix4.fromArray()` 消费这里的结果，一旦序或语义错，实例化画面会整体错位。
 */
import { describe, expect, it } from 'vitest';
import {
  IDENTITY_QUATERNION,
  mat4AlmostEqual,
  mat4AxisLengths,
  mat4Compose,
  mat4FromQuaternion,
  mat4Identity,
  mat4Multiply,
  mat4RotationX,
  mat4Scaling,
  mat4TransformPoint,
  mat4Translation,
} from './matrix';

const YAW_90 = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }; // 绕 Y +90°

describe('mat4 基础构造（列主序约定）', () => {
  it('恒等矩阵 = 对角 1、其余 0，平移位在索引 12/13/14', () => {
    expect(mat4Identity()).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it('平移矩阵把 x/y/z 落在第四列（column-major 的 te[12..14]）', () => {
    const m = mat4Translation(100, 200, 300);
    expect(m[12]).toBe(100);
    expect(m[13]).toBe(200);
    expect(m[14]).toBe(300);
    expect(m[15]).toBe(1);
  });

  it('缩放矩阵各列对角自乘', () => {
    expect(mat4Scaling(2, 3, 4)).toEqual([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1]);
  });

  it('绕 X 旋转矩阵与 three.js makeRotationX 同布局（te[6]=+s、te[9]=−s）', () => {
    const t = -Math.PI / 2;
    const m = mat4RotationX(t);
    expect(m[0]).toBeCloseTo(1);
    expect(m[5]).toBeCloseTo(Math.cos(t));
    expect(m[6]).toBeCloseTo(Math.sin(t));
    expect(m[9]).toBeCloseTo(-Math.sin(t));
    expect(m[10]).toBeCloseTo(Math.cos(t));
  });
});

describe('mat4FromQuaternion / mat4Compose', () => {
  it('恒等四元数 → 旋转部分等于恒等', () => {
    expect(mat4FromQuaternion(IDENTITY_QUATERNION)).toEqual(mat4Identity());
  });

  it('绕 Y +90° 把 +X 转到 −Z（three 右手系口径，转错方向 = 全场镜像）', () => {
    const p = mat4TransformPoint(mat4FromQuaternion(YAW_90), { x: 1, y: 0, z: 0 });
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(-1);
  });

  it('compose = T × R × S（与手算连乘逐元素相等）', () => {
    const pos = { x: 5000, y: 120, z: -300 };
    const scale = { x: 1.5, y: 0.5, z: 2 };
    const direct = mat4Compose(pos, YAW_90, scale);
    const chained = mat4Multiply(
      mat4Translation(pos.x, pos.y, pos.z),
      mat4Multiply(mat4FromQuaternion(YAW_90), mat4Scaling(scale.x, scale.y, scale.z)),
    );
    expect(mat4AlmostEqual(direct, chained)).toBe(true);
  });

  it('compose 的平移分量不受缩放污染（旧「整组被缩放」类缺陷的数学反证）', () => {
    const m = mat4Compose({ x: 10, y: 20, z: 30 }, IDENTITY_QUATERNION, { x: 9, y: 9, z: 9 });
    expect([m[12], m[13], m[14]]).toEqual([10, 20, 30]);
  });

  it('单位四元数 + 单位缩放 + 零平移 → 恒等', () => {
    expect(
      mat4AlmostEqual(
        mat4Compose({ x: 0, y: 0, z: 0 }, IDENTITY_QUATERNION, { x: 1, y: 1, z: 1 }),
        mat4Identity(),
      ),
    ).toBe(true);
  });
});

describe('mat4Multiply / 辅助函数', () => {
  it('任何矩阵乘恒等不变', () => {
    const m = mat4Compose({ x: 1, y: 2, z: 3 }, YAW_90, { x: 4, y: 5, z: 6 });
    expect(mat4AlmostEqual(mat4Multiply(m, mat4Identity()), m)).toBe(true);
    expect(mat4AlmostEqual(mat4Multiply(mat4Identity(), m), m)).toBe(true);
  });

  it('乘法不满足交换律（顺序写错必须被测出来）', () => {
    const a = mat4Translation(100, 0, 0);
    const b = mat4FromQuaternion(YAW_90);
    expect(mat4AlmostEqual(mat4Multiply(a, b), mat4Multiply(b, a))).toBe(false);
  });

  it('点变换含平移与缩放', () => {
    const m = mat4Compose({ x: 1000, y: 0, z: 0 }, IDENTITY_QUATERNION, { x: 2, y: 2, z: 2 });
    expect(mat4TransformPoint(m, { x: 300, y: 50, z: 0 })).toEqual({ x: 1600, y: 100, z: 0 });
  });

  it('轴长度取列向量模长（拾取粗筛把局部包围球半径放大到世界用）', () => {
    const m = mat4Compose({ x: 9, y: 9, z: 9 }, YAW_90, { x: 2, y: 3, z: 4 });
    const len = mat4AxisLengths(m);
    expect(len.x).toBeCloseTo(2);
    expect(len.y).toBeCloseTo(3);
    expect(len.z).toBeCloseTo(4);
  });

  it('mat4AlmostEqual 超出容差即不等', () => {
    const m = mat4Identity();
    const bad = [...m];
    bad[0] = 1.0001;
    expect(mat4AlmostEqual(m, bad, 1e-6)).toBe(false);
    expect(mat4AlmostEqual(m, bad, 1e-3)).toBe(true);
  });
});