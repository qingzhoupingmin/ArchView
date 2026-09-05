/**
 * 房间图层（架构拆分 Phase 4，自 `viewport.ts` 逐字迁出，T2.8 / P5）
 *
 * 职责边界：房间是**独立于组件的另一套场景对象**——半透明地板 + 裁剪刷 + 自带网格 + 高度轮廓，
 * 数量少（v1 单楼层 1-n 间）所以走全量对账而非增量缓存。
 *
 * 两条注入依赖（不许横向 import，见 eslint 依赖方向护栏）：
 * - `gridStep()`：房间自带网格要与场地网格同格距（P5），格距事实源在 SiteGrid；
 * - `clipMaterial`：裁剪刷共享材质由 SiteGrid 持有并释放，本层只引用不回收。
 * 而「拾取房间地板」需要射线与相机，那属于门面的拾取服务——本层只交出可命中目标。
 */
import * as THREE from 'three';
import { roomsExtent, type Room } from '@archview/core';
import { VP_GRID, VP_GRID_MAJOR, VP_HORIZON, VP_SELECTION } from '@archview/theme';
import {
  RENDER_ORDER,
  ROOM_FLOOR_COLOR,
  ROOM_FLOOR_COLOR_SELECTED,
  ROOM_Y,
  rectGridGeometry,
  roomGridMaterial,
} from '../room-visuals';
import { GRID_MAJOR_EVERY } from './constants';
import type { RoomEntry } from './types';

export interface RoomLayerDeps {
  /** 场地当前次网格格距（mm）：房间自带网格与场地网格同相位 */
  gridStep(): number;
  /** 裁剪刷共享材质（跨房间共享，随视口释放，见 disposeEntry 的「只摘节点不释放」约定） */
  clipMaterial(): THREE.MeshBasicMaterial;
  /** 3D 取景：框住区域中心与跨度 */
  frameArea(cx: number, cz: number, extent: number): void;
}

export class RoomLayer {
  private readonly scene: THREE.Scene;
  private readonly deps: RoomLayerDeps;
  /** 房间（T2.8）：数量少（v1 单楼层 1-n 间），全量同步即可，无需增量优化 */
  private readonly entries = new Map<string, RoomEntry>();
  /** 房间数据（2D 标注 / 取景用；sync 时更新） */
  rooms: Room[] = [];
  /** 当前选中的房间 ID（P5：房间可拾取）；与组件选择集互斥，由应用层收口 */
  selectedRoomId: string | null = null;

  constructor(scene: THREE.Scene, deps: RoomLayerDeps) {
    this.scene = scene;
    this.deps = deps;
  }

  /**
   * 房间全量同步：半透明地板（粉色，标出「这是房间」）+ 线框轮廓（高度感）。
   * 尺寸 / 位置 / 楼层变化（key 指纹不一致）时销毁重建几何，避免残留旧尺寸。
   */
  sync(rooms: Room[]): void {
    this.rooms = [...rooms];
    if (this.selectedRoomId && !rooms.some((r) => r.id === this.selectedRoomId)) {
      this.selectedRoomId = null; // 选中的房间被删除 / 撤销：高亮随之失效
    }
    const seen = new Set<string>();
    for (const room of rooms) {
      seen.add(room.id);
      const key = this.roomKey(room);
      const existing = this.entries.get(room.id);
      if (!existing || existing.key !== key) {
        if (existing) this.disposeEntry(existing);
        const entry: RoomEntry = { group: this.buildGroup(room), key };
        this.entries.set(room.id, entry);
        this.scene.add(entry.group);
      }
    }
    for (const id of [...this.entries.keys()]) {
      if (seen.has(id)) continue;
      const entry = this.entries.get(id);
      if (entry) {
        this.disposeEntry(entry);
        this.entries.delete(id);
      }
    }
  }

  /** 全量重建房间图形（选中态切换 / 网格步长变化；房间数量少，重建代价可忽略） */
  rebuild(): void {
    for (const [id, entry] of [...this.entries]) {
      this.disposeEntry(entry);
      this.entries.delete(id);
    }
    for (const room of this.rooms) {
      const group = this.buildGroup(room);
      this.entries.set(room.id, { group, key: this.roomKey(room) });
      this.scene.add(group);
    }
  }

  /**
   * 房间选中态（P5：房间可拾取）：选中房间 = 与组件同一支粉（地板浅染 + 轮廓实粉）。
   * 房间不参与多选与变换手柄，选择语义与组件互斥（应用层负责清组件选择集）。
   * @returns 选中态是否真的变化（门面据此决定要不要重画）
   */
  select(id: string | null): boolean {
    const next = id && this.rooms.some((r) => r.id === id) ? id : null;
    if (next === this.selectedRoomId) return false;
    this.selectedRoomId = next;
    this.rebuild();
    return true;
  }

  /** 可命中的房间地板目标（P5 兜底拾取：组件优先命中，房间是第二路） */
  floorTargets(): THREE.Object3D[] {
    const targets: THREE.Object3D[] = [];
    for (const entry of this.entries.values()) {
      for (const child of entry.group.children) {
        if (child.userData.pick === 'roomFloor') targets.push(child);
      }
    }
    return targets;
  }

  /** 3D 自动取景：框住全部房间占地（新建房间后调用；2D 有自己的自适应取景） */
  frameRooms(): boolean {
    const fit = roomsExtent(this.rooms);
    if (!fit) return false;
    this.deps.frameArea(fit.cx, fit.cz, fit.extent);
    return true;
  }

  /**
   * 房间显示（P5 重做，产品文档 §10.4）：
   * ① 裁剪刷——把占地写进 stencil（不写色不写深），场地网格在房间内被丢弃；
   * ② 地板——抬到场地网格之上（y=4），中性浅底而非品牌粉，粉色留给动作与选中；
   * ③ 房间自带网格——与世界网格同相位，房间内外是同一套格，只是底色更干净；
   * ④ 高度轮廓——底圈抬到地板之上（y=4.5），不再与地面共面 z-fighting；
   *    选中态整组换成 VP_SELECTION 粉（与组件选中同一支粉）。
   */
  private buildGroup(room: Room): THREE.Group {
    const group = new THREE.Group();
    group.userData.roomId = room.id;
    const baseY = (room.floorIndex - 1) * room.height; // 多楼层叠加（FR-M10 预留）
    const selected = this.selectedRoomId === room.id;
    const minX = room.position.x - room.width / 2;
    const maxX = room.position.x + room.width / 2;
    const minZ = room.position.z - room.depth / 2;
    const maxZ = room.position.z + room.depth / 2;

    // ① 裁剪刷：材质跨房间共享，随实例释放会毁掉其它房间的裁剪（见 disposeEntry）
    const clip = new THREE.Mesh(
      new THREE.PlaneGeometry(room.width, room.depth),
      this.deps.clipMaterial(),
    );
    clip.rotation.x = -Math.PI / 2;
    clip.position.set(room.position.x, baseY + ROOM_Y.floor - 0.5, room.position.z);
    group.add(clip);

    // ② 地板
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(room.width, room.depth),
      new THREE.MeshBasicMaterial({
        color: selected ? ROOM_FLOOR_COLOR_SELECTED : ROOM_FLOOR_COLOR,
        transparent: true,
        opacity: selected ? 0.18 : 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(room.position.x, baseY + ROOM_Y.floor, room.position.z);
    floor.renderOrder = RENDER_ORDER.roomFloor;
    floor.userData.roomId = room.id;
    floor.userData.pick = 'roomFloor';
    group.add(floor);

    // ③ 房间自带网格：格距与场地一致，线落在世界整数倍上
    const minor = this.deps.gridStep();
    const gridMinor = new THREE.LineSegments(
      rectGridGeometry(minX, minZ, maxX, maxZ, minor),
      roomGridMaterial(VP_GRID, 0.85),
    );
    gridMinor.position.y = baseY + ROOM_Y.gridMinor;
    gridMinor.renderOrder = RENDER_ORDER.roomOverlay;
    group.add(gridMinor);
    const gridMajor = new THREE.LineSegments(
      rectGridGeometry(minX, minZ, maxX, maxZ, minor * GRID_MAJOR_EVERY),
      roomGridMaterial(VP_GRID_MAJOR, 0.95),
    );
    gridMajor.position.y = baseY + ROOM_Y.gridMajor;
    gridMajor.renderOrder = RENDER_ORDER.roomOverlay;
    group.add(gridMajor);

    // ④ 高度轮廓：底圈抬到地板之上，不再与地面共面
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(room.width, room.height, room.depth)),
      new THREE.LineBasicMaterial({
        color: new THREE.Color(selected ? VP_SELECTION : VP_HORIZON),
        transparent: true,
        opacity: selected ? 1 : 0.9,
      }),
    );
    edges.position.set(room.position.x, baseY + ROOM_Y.edge + room.height / 2, room.position.z);
    edges.renderOrder = RENDER_ORDER.roomOverlay;
    edges.userData.roomId = room.id;
    group.add(edges);

    return group;
  }

  /** 尺寸 / 位置 / 楼层指纹：任一变化即重建几何 */
  private roomKey(room: Room): string {
    return `${room.width}|${room.depth}|${room.height}|${room.position.x}|${room.position.z}|${room.floorIndex}`;
  }

  private disposeEntry(entry: RoomEntry): void {
    this.scene.remove(entry.group);
    for (const child of entry.group.children) {
      const obj = child as THREE.Mesh;
      obj.geometry.dispose();
      const mat = obj.material as THREE.Material;
      // 裁剪刷材质跨房间共享，只摘节点不释放（同 T2.10f 共享几何的处置约定）
      if (mat !== this.deps.clipMaterial()) mat.dispose();
    }
  }

  /** 摘掉全部房间节点与本层持有的材质 / 几何；裁剪刷共享材质由 SiteGrid 释放 */
  dispose(): void {
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
  }
}