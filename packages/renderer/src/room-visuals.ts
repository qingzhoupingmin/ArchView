/**
 * 房间视觉常量与几何助手（P5：房间地板与场地地板冲突修复）——从 viewport.ts 拆出，
 * 分层常量只留一处事实源。
 *
 * 病灶回顾（截图反馈「建造房间后与原始的地板效果产生冲突」）：
 * 旧实现房间地板 y=1.5 落在场地次网格(y=2) / 主网格(y=3) 之下，场地网格照旧画在
 * 房间地板上，房间没有「自己的地板」；线框底圈又与地面严格共面（y=0）→ 斜视角
 * z-fighting；三层透明面片没有显式 renderOrder，靠质心距离隐式排序，转视角会跳变。
 */
import * as THREE from 'three';
import { VP_GROUND, VP_SELECTION } from '@archview/theme';

/**
 * Y 层分配表：任何两个可视面都不共面，房间层整体压在场地网格之上。
 * 房间地板抬到 y=4（场地主网格 3 之上）后变成「染色层」：透过它仍看得见地面阴影，
 * 而场地网格已被裁剪刷从 stencil 里丢弃，改由房间自带网格接管。
 */
export const SITE_Y = { edge: 1, gridMinor: 2, gridMajor: 3 };
export const ROOM_Y = { floor: 4, edge: 4.5, gridMinor: 5, gridMajor: 6 };

/** 透明层显式绘制顺序：场地网格 → 房间地板 → 房间网格 / 轮廓（P5 R3：不再靠隐式排序） */
export const RENDER_ORDER = { siteGrid: 1, roomFloor: 2, roomOverlay: 3 };

/** 房间地板色（未选中）：VP_GROUND 向白插值，室内地面比场地更亮，且不占用粉色语义 */
export const ROOM_FLOOR_COLOR = new THREE.Color(VP_GROUND).lerp(new THREE.Color(0xffffff), 0.62);

/** 房间地板色（选中）：与组件选中同一支粉，低透明度只做染色（§10.2 原则 1） */
export const ROOM_FLOOR_COLOR_SELECTED = new THREE.Color(VP_SELECTION);

/**
 * 矩形范围内的世界对齐网格线（房间自带地板网格）：线落在 step 的整数倍世界坐标上，
 * 与场地网格同相位——房间内外看着是同一套格，只是房间里的格子换了更干净的底色。
 * 几何局部坐标 = 世界坐标，物体只负责把整组线抬到指定 y。
 */
export function rectGridGeometry(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  step: number,
): THREE.BufferGeometry {
  const s = Math.max(step, 1);
  const pts: number[] = [];
  const first = (v: number) => Math.ceil(v / s - 1e-6) * s;
  for (let x = first(minX); x <= maxX + 1e-6; x += s) pts.push(x, 0, minZ, x, 0, maxZ);
  for (let z = first(minZ); z <= maxZ + 1e-6; z += s) pts.push(minX, 0, z, maxX, 0, z);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return geo;
}

/**
 * 场地网格的 stencil 裁剪设置：房间裁剪刷把占地写成 1，网格在 ref=1 处丢弃。
 * three 只在 material.stencilWrite === true 时才开 STENCIL_TEST，故这里 write 必须为 true，
 * 再用 writeMask=0 做到「只测不写」——否则网格会把相邻房间的区域也一起涂掉。
 *
 * 视口拆分 Phase 2 落点：场地网格（SiteGrid）与房间自带网格（RoomLayer）都要用它，
 * 放这里而不是任何一侧，免得协作者互相 import（依赖方向护栏）。
 */
export function applyRoomClip(mat: THREE.Material): void {
  mat.stencilWrite = true;
  mat.stencilWriteMask = 0;
  mat.stencilFunc = THREE.NotEqualStencilFunc;
  mat.stencilRef = 1;
  mat.stencilFuncMask = 0xff;
}

/** 房间自带网格材质：与场地网格同色同透明度，但不参与 stencil（房间内正是要在这里画线） */
export function roomGridMaterial(colorHex: string, opacity: number): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: new THREE.Color(colorHex),
    transparent: true,
    opacity,
  });
}

/**
 * 房间裁剪刷共享材质：把房间占地写进 stencil（不写色不写深），场地网格据此丢弃。
 * 工厂而非单例——每个视口实例一份，随视口 dispose 释放
 * （/fps 基线页会顺序创建多个 Viewport3D，模块级单例会被先销毁的那个连带释放掉）。
 */
export function makeRoomClipMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilRef: 1,
    stencilWriteMask: 0xff,
    stencilZPass: THREE.ReplaceStencilOp,
  });
}
