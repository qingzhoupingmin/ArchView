/**
 * 房间几何纯函数（P5：房间地板与场地地板冲突修复，产品文档 §8.2-10 / §10.4）：
 * 占地矩形、同层占地重叠判定、场地尺寸生长、新房间默认位置、房间集合取景包围盒。
 * 渲染层（视口）与弹窗（位置输入 / 重叠校验）共用同一份实现，避免两处语义漂移。
 * 单位一律 mm，XZ 平面；Room.position 为占地中心（§6.2 与组件原点约定一致）。
 */
import { snapToGrid } from './grid';
import type { Room, Vec2 } from './types';

/** XZ 平面占地矩形（含边界） */
export interface RoomRect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** roomRect 的最小输入（弹窗里房间还没建好也能直接校验） */
export interface RoomFootprintInput {
  width: number;
  depth: number;
  position: Vec2;
}

/** 房间占地矩形：position 为占地中心，故半跨 = 尺寸 / 2 */
export function roomRect(room: RoomFootprintInput): RoomRect {
  const hw = room.width / 2;
  const hd = room.depth / 2;
  return {
    minX: room.position.x - hw,
    maxX: room.position.x + hw,
    minZ: room.position.z - hd,
    maxZ: room.position.z + hd,
  };
}

/**
 * 两占地是否重叠。贴边不算重叠——共墙是正常布局（机房 A 与机房 B 共用一面墙）；
 * tol（mm）为正时按「双方各让开 tol」再判，给浮点误差留余量。
 */
export function roomRectsOverlap(a: RoomRect, b: RoomRect, tol = 0): boolean {
  return (
    a.minX < b.maxX - tol && b.minX < a.maxX - tol && a.minZ < b.maxZ - tol && b.minZ < a.maxZ - tol
  );
}

/** 同楼层占地重叠的房间（不同 floorIndex 允许重叠：上下叠层是 FR-M10 的语义） */
export function findRoomOverlap(
  candidate: RoomFootprintInput & { floorIndex: number },
  rooms: readonly Room[],
  idToIgnore?: string,
): Room | undefined {
  const rect = roomRect(candidate);
  return rooms.find(
    (r) =>
      r.id !== idToIgnore &&
      r.floorIndex === candidate.floorIndex &&
      roomRectsOverlap(rect, roomRect(r)),
  );
}

/**
 * 场地尺寸（mm）：把全部房间框进去并留边距，向上取整到 quantum 的整数倍。
 * quantum 取吸附步长，保证场地生长后网格线相位不漂移（渲染层按 size / step 整除分格）。
 * 无房间时返回 min（= 旧版写死的 36000），零行为变化。
 */
export function computeSiteSize(
  rooms: readonly Room[],
  opts: { min: number; margin: number; quantum: number },
): number {
  let span = 0;
  for (const room of rooms) {
    const r = roomRect(room);
    span = Math.max(span, Math.abs(r.minX), Math.abs(r.maxX), Math.abs(r.minZ), Math.abs(r.maxZ));
  }
  const q = Math.max(opts.quantum, 1);
  const need = Math.max(opts.min, (span + Math.max(opts.margin, 0)) * 2);
  return Math.ceil(need / q - 1e-9) * q;
}

/**
 * 新房间默认位置（P5 R6）：排到同楼层已有房间并集的东侧（+X），贴边留 gap 并按 step 吸附。
 * 病灶：v1 弹窗恒以世界原点为中心放置，第二个房间必然与第一个共面重叠、粉层互相 z-fighting。
 * 同楼层没有房间时回退世界原点，保持旧工程与示例数据的表现不变。
 */
export function nextRoomPosition(
  rooms: readonly Room[],
  size: { width: number },
  opts: { step: number; gap: number; floorIndex: number },
): Vec2 {
  let maxX = -Infinity;
  for (const r of rooms) {
    if (r.floorIndex !== opts.floorIndex) continue;
    maxX = Math.max(maxX, roomRect(r).maxX);
  }
  if (!Number.isFinite(maxX)) return { x: 0, z: 0 };
  return { x: snapToGrid(maxX + opts.gap + size.width / 2, opts.step), z: 0 };
}

/** 房间集合的取景包围盒（3D 新建房间后自动取景）：extent = 最长边；空集合返回 null */
export function roomsExtent(
  rooms: readonly Room[],
): { cx: number; cz: number; extent: number } | null {
  if (rooms.length === 0) return null;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const r of rooms) {
    const b = roomRect(r);
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minZ = Math.min(minZ, b.minZ);
    maxZ = Math.max(maxZ, b.maxZ);
  }
  return {
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    extent: Math.max(maxX - minX, maxZ - minZ),
  };
}

/** 房间占地面积（mm^2）：属性面板与 T3.1 面积统计同一口径 */
export function roomArea(room: RoomFootprintInput): number {
  return Math.max(room.width, 0) * Math.max(room.depth, 0);
}
