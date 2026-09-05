import { yawDegrees } from './transform';
import type { Quaternion, Size, Vec3 } from './types';

/**
 * 2D 框选纯函数（T2.6 / T2.4 遗留 / FR-M07 / FR-V02，开发计划 §4.2 T2.6）：
 * - 选区与组件占地均在 XZ 平面（mm，世界坐标）；
 * - 命中规则：组件占地（旋转后的包围盒 AABB）与选区相交即选中
 *   （v1 不做 CAD 式 window / crossing 区分，规则简单可预期）；
 * - 占地按 size（§8.2-9 单一事实源）+ Y 轴偏航计算 AABB，旋转组件不会被橡皮筋漏选。
 * - 零 three.js 依赖：渲染层（拾取后）与未来 E2E / 导出逻辑共用。
 */

/** XZ 平面矩形（mm，min/max 已归一化） */
export interface Rect2D {
  xMin: number;
  zMin: number;
  xMax: number;
  zMax: number;
}

/** 由两个角点坐标构造归一化矩形（mm；任意先后顺序） */
export function rect2D(x: number, z: number, x2: number, z2: number): Rect2D {
  return {
    xMin: Math.min(x, x2),
    zMin: Math.min(z, z2),
    xMax: Math.max(x, x2),
    zMax: Math.max(z, z2),
  };
}

/**
 * 组件 XZ 占地 AABB（mm）：中心在实例位置，半宽按 Y 轴偏航旋转后的投影计算。
 * 2.5D 模型只有 Y 轴旋转：占地旋转 θ 后的轴向包围盒 = (|w·cosθ| + |d·sinθ|) × (|w·sinθ| + |d·cosθ|)。
 */
export function footprintAABB(
  position: { x: number; z: number },
  rotation: Quaternion,
  size: Size,
): Rect2D {
  const rad = (yawDegrees(rotation) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const ex = (size.w * cos + size.d * sin) / 2;
  const ez = (size.w * sin + size.d * cos) / 2;
  return {
    xMin: position.x - ex,
    zMin: position.z - ez,
    xMax: position.x + ex,
    zMax: position.z + ez,
  };
}

/** 矩形相交（边相切也算相交——橡皮筋擦到组件边缘应可选中） */
export function rectsIntersect(a: Rect2D, b: Rect2D): boolean {
  return a.xMin <= b.xMax && a.xMax >= b.xMin && a.zMin <= b.zMax && a.zMax >= b.zMin;
}

/**
 * 框选命中：返回占地与选区相交的组件 ID（保持输入顺序）。
 * 入参只要求 position / rotation / size 最小字段集——渲染层可把自己的组件缓存直接传入。
 */
export function rubberBandSelect(
  items: Array<{ id: string; position: Vec3; rotation: Quaternion; size: Size }>,
  rect: Rect2D,
): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (rectsIntersect(footprintAABB(it.position, it.rotation, it.size), rect)) out.push(it.id);
  }
  return out;
}
