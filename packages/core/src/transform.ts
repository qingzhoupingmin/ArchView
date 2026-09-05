import { snapToGrid } from './grid';
import { uid } from './ids';
import type { Component, Quaternion, Size } from './types';

/**
 * 变换纯函数（T2.3 / FR-M05 / FR-M06，产品文档 §8.2-9）：
 * - rotation 存四元数（2.5D：仅 Y 轴偏航），deg ↔ 四元数换算与 90° 步进吸附由本文件收口，UI 层不自行计算；
 * - size 为实例尺寸唯一事实源（非等比缩放直接写 size；scale 恒 (1,1,1)，预留 glTF 时代扩展）；
 * - 复制 / 镜像 / 矩形阵列生成「新实例」（新 id、原名保留，重名自动编号由 Document 在添加时处理，FR-M09）。
 */

/** Y 轴旋转角（deg）→ 四元数（FR-M06；UI 层 deg → 四元数的唯一入口） */
export function yawQuaternion(deg: number): Quaternion {
  const rad = (deg * Math.PI) / 180;
  const s = Math.sin(rad / 2);
  const c = Math.cos(rad / 2);
  return { x: 0, y: s, z: 0, w: c };
}

/** 角度归一化：任意角度 → [0, 360)（FR-M03 / T2.5：属性面板任意角度输入的收口；UI 层角度归一化唯一入口） */
export function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** 四元数 → Y 轴旋转角（deg，归一化到 [0, 360)）；用于 90° 步进显示与吸附（FR-M06） */
export function yawDegrees(q: Quaternion): number {
  const sin = 2 * (q.w * q.y + q.x * q.z);
  const cos = 1 - 2 * (q.y * q.y + q.z * q.z);
  return normalizeDegrees((Math.atan2(sin, cos) * 180) / Math.PI);
}

/** 角度吸附：默认 90° 步进（FR-M06 手柄约定；任意角度输入走 T2.5 属性面板） */
export function snapAngle(deg: number, step = 90): number {
  return normalizeDegrees(Math.round(deg / step) * step);
}

/** 矩形阵列选项（FR-M05）：行向 +Z 展开、列向 +X 展开；dx / dz 为相邻中心距（mm） */
export interface RectArrayOptions {
  /** 行数（+Z 方向） */
  rows: number;
  /** 列数（+X 方向） */
  cols: number;
  /** 列间距：相邻列中心距（mm） */
  dx: number;
  /** 行间距：相邻行中心距（mm） */
  dz: number;
  /** 网格吸附步长（mm；0 = 不吸附，FR-M04） */
  snapStep?: number;
}

/**
 * 阵列默认间距（与黄金样例 / 性能基线 buildArray 同一约定）：
 * 列距 = 宽 + 600（柜体并排留一格），行距 = 深 + 1200（中间冷通道）。
 */
export function defaultArraySpacing(size: Size): { dx: number; dz: number } {
  return { dx: size.w + 600, dz: size.d + 1200 };
}

function cloneComponent(c: Component): Component {
  return JSON.parse(JSON.stringify(c)) as Component;
}

/**
 * 矩形阵列（FR-M05）：第一格锚定在基准组件当前位置，向 +X（列）/ +Z（行）展开。
 * 每格独立新实例（新 id；scale 恒 (1,1,1)，size 单一事实源 §8.2-9）；
 * 名称保留原名，Document 添加时自动编号（FR-M09）；
 * snapStep > 0 时逐格吸附网格（FR-M04）。
 */
export function buildRectArray(base: Component, opts: RectArrayOptions): Component[] {
  const rows = Math.max(1, Math.round(opts.rows));
  const cols = Math.max(1, Math.round(opts.cols));
  const step = opts.snapStep ?? 0;
  const out: Component[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const m = cloneComponent(base);
      let x = base.position.x + c * opts.dx;
      let z = base.position.z + r * opts.dz;
      if (step > 0) {
        x = snapToGrid(x, step);
        z = snapToGrid(z, step);
      }
      m.id = uid('c');
      m.position = { x, y: base.position.y, z };
      out.push(m);
    }
  }
  return out;
}

/**
 * 镜像（FR-M05）：关于指定竖直平面反射——'yz' 即 x → -x，'xz' 即 z → -z；
 * 2.5D 模型下镜像等价于 Y 轴偏航角取反（对称柜体与 180° 旋转结果一致，
 * 非对称图元则保留真正的镜像方向）。返回新实例（新 id；原名保留，Document 自动编号）。
 */
export function mirrorComponent(comp: Component, plane: 'yz' | 'xz' = 'yz'): Component {
  const m = cloneComponent(comp);
  if (plane === 'yz') {
    m.position = { x: -comp.position.x, y: comp.position.y, z: comp.position.z };
  } else {
    m.position = { x: comp.position.x, y: comp.position.y, z: -comp.position.z };
  }
  m.rotation = yawQuaternion(-yawDegrees(comp.rotation));
  m.id = uid('c');
  return m;
}