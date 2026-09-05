/**
 * 4×4 矩阵纯函数（S2.5 / T2.10g 实例化批渲染，开发计划 §4.3 T5.0）。
 *
 * 为什么放在 core 而不是渲染层：批渲染下「一个组件实例的某个图元在世界里的位姿」
 * 必须与旧的三层场景图（`group(位姿) > holder(不缩放 offset) > mesh(scale=ratio)`，T2.10e）**逐元素等价**，
 * 否则实例化一开，吊顶件的安装高度、非等比缩放的偏移语义就会悄悄漂移——而这种漂移
 * 只能在浏览器里肉眼发现。把算式收口成 core 纯函数，等价性就能被单测钉死（渲染层零 three 依赖也可测）。
 *
 * 存储约定：**列主序 16 元素**，与 three.js `Matrix4.elements` 完全同序，
 * 渲染层可直接 `new THREE.Matrix4().fromArray(m)` 使用，不做任何重排。
 * 坐标系与单位见产品文档 §6.4（右手系、Y 轴向上、mm）。
 */
import type { Quaternion, Vec3 } from './types';

/** 列主序 4×4 矩阵（`m[col * 4 + row]`） */
export type Mat4 = number[];

/** 单位四元数（不旋转） */
export const IDENTITY_QUATERNION: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

/** 恒等矩阵 */
export function mat4Identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** 平移矩阵 */
export function mat4Translation(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

/** 缩放矩阵（各轴独立，允许负值用于镜像） */
export function mat4Scaling(x: number, y: number, z: number): Mat4 {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

/** 绕 X 轴旋转矩阵（弧度）——通用旋转工具（v3.9 前曾用于 `plane` 图元躺平，现 plane 为竖屏面零旋转） */
export function mat4RotationX(radians: number): Mat4 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

/**
 * 四元数 → 旋转矩阵。
 * 公式与 three.js `Matrix4.makeRotationFromQuaternion` 逐字一致（含列主序落位），
 * 这样 `mat4Compose` 与 three 的 `Matrix4.compose` 产出同一份 elements。
 */
export function mat4FromQuaternion(q: Quaternion): Mat4 {
  const { x, y, z, w } = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    1 - (yy + zz),
    xy + wz,
    xz - wy,
    0,
    xy - wz,
    1 - (xx + zz),
    yz + wx,
    0,
    xz + wy,
    yz - wx,
    1 - (xx + yy),
    0,
    0,
    0,
    0,
    1,
  ];
}

/** 矩阵乘法 `a × b`（列主序，与 three `Matrix4.multiplyMatrices` 同结果） */
export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

/**
 * 平移 × 旋转 × 缩放组合（`T × R × S`），等价于 three.js `Matrix4.compose(position, quaternion, scale)`
 * 与 `Object3D.updateMatrix()`。这是本模块唯一的「造矩阵」入口，位姿一律走它以保证与渲染层一致。
 */
export function mat4Compose(position: Vec3, quaternion: Quaternion, scale: Vec3): Mat4 {
  const m = mat4FromQuaternion(quaternion);
  // 三列分别乘以对应轴的缩放（three 的 `Matrix4.scale` 就是这个操作）
  for (let row = 0; row < 3; row++) {
    m[row] *= scale.x;
    m[4 + row] *= scale.y;
    m[8 + row] *= scale.z;
  }
  m[12] = position.x;
  m[13] = position.y;
  m[14] = position.z;
  return m;
}

/** 点变换（w = 1，含平移与缩放） */
export function mat4TransformPoint(m: Mat4, v: Vec3): Vec3 {
  return {
    x: m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12],
    y: m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13],
    z: m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14],
  };
}

/**
 * 矩阵的三轴实际缩放长度（列向量的模长）。
 * 批渲染拾取用它把「图元局部包围球半径」放大成世界半径做粗筛——仿射变换下这是上界，不会漏检。
 */
export function mat4AxisLengths(m: Mat4): Vec3 {
  return {
    x: Math.hypot(m[0], m[1], m[2]),
    y: Math.hypot(m[4], m[5], m[6]),
    z: Math.hypot(m[8], m[9], m[10]),
  };
}

/** 逐元素近似相等（浮点算式跨实现比较用，单测断言口径） */
export function mat4AlmostEqual(a: Mat4, b: Mat4, eps = 1e-6): boolean {
  if (a.length !== 16 || b.length !== 16) return false;
  for (let i = 0; i < 16; i++) if (Math.abs(a[i]! - b[i]!) > eps) return false;
  return true;
}
