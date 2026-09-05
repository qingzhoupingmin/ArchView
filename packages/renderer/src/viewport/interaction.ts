/**
 * 视口手势层（架构拆分 Phase 4，自 `viewport.ts` 逐字迁出，交互范式改版 §10.3）
 *
 * 只管**输入设备与手势状态机**：按下 / 抬起 / 移动 / 双击 / 右键，以及三条手势——
 * ① 组件直接拖拽（pendingMove）② 2D 框选橡皮筋（rubber）③ 同位连点穿透（lastClick）。
 * 它不持有相机、不持有场景对象，一切跨块能力经 `InteractionHost` 由门面供给；
 * 拾取、位姿写入、描边刷新、选择上报都是「问门面要」，因此本文件可以脱离 three 场景单测。
 *
 * 语义要点（改这里前务必读，都是验收过的行为）：
 * - 位移 ≤5px 视为点击（CLICK_SLOP_SQ），走 handleClick 的选择 / 穿透管线；
 * - 拖组件 = 直接移动，2D / 3D 同语义；整个选择集一起动 = 单条撤销记录（FR-M08）；
 * - 按下时命中的组件若不在选择集，**不立刻改选择**，拖拽提交时才补报（避免手抖换选中）；
 * - pointerdown 注册在捕获阶段，「Ctrl+左键 = 平移」的临时 mouseButtons 才对当前手势生效。
 */
import { rect2D, rubberBandSelect, snapToGrid, type Component } from '@archview/core';
import type { Overlay2D } from '../overlay2d';
import { CLICK_SLOP_SQ, CLICK_THROUGH_WINDOW_MS } from './constants';
import type { ContextHit, ViewMode, ViewportCallbacks } from './types';

/** 门面供给的跨块能力（本层唯一的对外依赖面） */
export interface InteractionHost {
  /** 事件回调集合（手势结果一律上报应用层，渲染层不持有持久选择） */
  readonly cb: ViewportCallbacks;
  /** canvas 元素：指针捕获与坐标基准 */
  readonly dom: HTMLElement;
  mode(): ViewMode;
  /** 当前选择集与主选中 */
  selection(): { ids: string[]; primary: string | null };
  /** 命中组件 ID（近 → 远） */
  pickAll(clientX: number, clientY: number): string[];
  /** 兜底命中房间地板 */
  pickRoom(clientX: number, clientY: number): string | null;
  /** 屏幕坐标 → 地面（y=0）世界坐标（mm） */
  groundPoint(clientX: number, clientY: number): { x: number; z: number } | null;
  /** 全部组件（2D 框选命中判定用，走 core.rubberBandSelect） */
  components(): Component[];
  /**
   * 条目当前位姿（mm）：group 是渲染层的位姿事实源，可能领先 Document 一帧（拖拽预览期间）。
   * y 恒等于 comp.position.y（直接拖拽只改 XZ，applyTransform 写入的 Y 不动）。
   */
  entryPose(id: string): { x: number; y: number; z: number } | undefined;
  /** 位姿写入（拖拽预览）：solo 改 mesh、批路径连带重写实例矩阵 */
  moveEntry(id: string, x: number, z: number): void;
  /** 刷新该组件的粉色描边 */
  refreshBox(id: string): void;
  /** 变换手柄（单选附着）跟随直接拖拽 */
  syncHandle(id: string, x: number, z: number): void;
  /** 拖拽件临时摘出 / 归回实例桶（T2.10h） */
  beginMoveSolo(ids: string[]): void;
  endMoveSolo(): void;
  /** 网格吸附约定（FR-M04，与放置 / 变换手柄同一口径） */
  snapEnabled(): boolean;
  snapStep(): number;
  /** 2D 期间临时禁用 OrbitControls 平移，避免与拖拽 / 框选抢事件 */
  set2dControlsEnabled(on: boolean): void;
  /** 3D 左键默认动作：Ctrl+左键拖拽期间临时切 PAN，pointerup 复位（§10.3） */
  set3dLeftButtonPan(on: boolean): void;
}

/** 直接拖拽手势（2D/3D 共用；松手提交 / 短按视为点击） */
interface PendingMove {
  ids: string[];
  hitId: string;
  /** hitId 按下时不在选择集 → 拖拽提交时补报选择（避免按下即改选择） */
  changed: boolean;
  additive: boolean;
  ground: { x: number; z: number };
  startPos: Map<string, { x: number; z: number }>;
}

/** 穿透点击追踪（T2.4 / FR-M07）：同位 1s 内重复点击 → 逐层深入拾取结果 */
interface LastClick {
  x: number;
  y: number;
  at: number;
  level: number;
  hits: string[];
}

export class InteractionManager {
  private readonly host: InteractionHost;
  private readonly overlay: Overlay2D;
  private pendingMove: PendingMove | null = null;
  /** 2D 橡皮筋（容器像素坐标；Shift+左键拖拽中） */
  private rubber: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private lastClick: LastClick | null = null;
  private downPos: { x: number; y: number } | null = null;
  /** 最近一次发出的光标坐标（取整 mm）：节流用，避免鼠标抖动导致 StatusBar 高频重渲染 */
  private lastCursor: { x: number; z: number } | null = null;

  constructor(host: InteractionHost, overlay: Overlay2D) {
    this.host = host;
    this.overlay = overlay;
  }

  /** 光标坐标节流上报（pointermove / pointerleave 共用） */
  private emitCursor(pt: { x: number; z: number } | null): void {
    const r = pt ? { x: Math.round(pt.x), z: Math.round(pt.z) } : null;
    if (r && this.lastCursor && r.x === this.lastCursor.x && r.z === this.lastCursor.z) return;
    if (!r && !this.lastCursor) return;
    this.lastCursor = r;
    this.host.cb.onCursorMove(pt);
  }

  /** 切视图模式时收尾进行中的手势（极端情况：Tab 在拖拽中被按下） */
  cancelGestures(): void {
    if (this.pendingMove) {
      this.pendingMove = null;
      this.host.endMoveSolo();
    }
    if (this.rubber) {
      this.rubber = null;
      this.overlay.setRubber(null);
      this.host.set2dControlsEnabled(true);
    }
  }

  /** 绑定指针事件（pointerdown 必须走捕获阶段，见 onPointerDown 注释） */
  bind(): void {
    const el = this.host.dom;
    el.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('dblclick', this.onDoubleClick);
    // 屏蔽浏览器原生右键菜单（2D/3D 均用自绘详情菜单，交互范式改版 §10.3）
    el.addEventListener('contextmenu', this.onContextMenuNative);
  }

  /** 解绑（与 bind 严格配对，dispose 内先解绑再拆场景） */
  unbind(): void {
    const el = this.host.dom;
    el.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('dblclick', this.onDoubleClick);
    el.removeEventListener('contextmenu', this.onContextMenuNative);
  }

  private onContextMenuNative = (e: Event): void => {
    e.preventDefault();
  };

  /** 右键命中目标（详情菜单）：组件优先、房间地板兜底、空处 = 双 null */
  contextHit(clientX: number, clientY: number): ContextHit {
    const hits = this.host.pickAll(clientX, clientY);
    const componentId = hits.length > 0 ? hits[0] : null;
    return { componentId, roomId: componentId ? null : this.host.pickRoom(clientX, clientY) };
  }

  /** 客户端坐标 → 容器相对像素（2D 覆盖层 / 橡皮筋 / 右键菜单坐标基准） */
  private containerPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.host.dom.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.downPos = { x: e.clientX, y: e.clientY };
    if (this.host.mode() === '3d') {
      // 左键：命中组件 = 直接拖拽（2D/3D 同语义）；空处 + Ctrl / Cmd = 平移（无中键触屏板兜底，§10.3）。
      // 本监听在捕获阶段、先于 OrbitControls 执行：临时 LEFT=PAN 才能对当前手势生效（pointerup 复位）
      if (e.button === 0 && !e.shiftKey && !this.tryStartMoveDrag(e) && (e.ctrlKey || e.metaKey)) {
        this.host.set3dLeftButtonPan(true);
      }
      return;
    }
    // ---- 2D（交互范式改版 §10.3：左键选择/拖拽 · Shift+左键框选 · 中键/右键平移 · 右键菜单 · 滚轮缩放）----
    if (e.button !== 0) return; // 中键 = 平移，右键 = 菜单 / 平移（OrbitControls）
    const el = this.host.dom;
    if (e.shiftKey) {
      // Shift + 左键 = 框选（T2.4 遗留 / FR-M07）
      const p = this.containerPoint(e.clientX, e.clientY);
      this.rubber = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      this.overlay.setRubber(this.rubber);
      this.host.set2dControlsEnabled(false);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* 指针已释放（极快点击），忽略 */
      }
      return;
    }
    // 左键：命中组件 = 直接拖拽 / 点击选择；空处不做动作（中键 / WASD 平移，交互范式改版）
    this.tryStartMoveDrag(e);
  };

  /**
   * 组件直接拖拽（2D/3D 共用，交互范式改版：左键只负责「选 / 移组件」）：
   * 命中组件 → 建立拖拽手势（网格吸附 + 实时预览，pointerup 的 finishPendingMove 收口）；
   * 未命中（空处）→ 返回 false（3D 下 Ctrl+左键走平移兜底，否则不做动作）。
   */
  private tryStartMoveDrag(e: PointerEvent): boolean {
    const hits = this.host.pickAll(e.clientX, e.clientY);
    if (hits.length === 0) return false;
    const hitId = hits[0];
    const additive = e.ctrlKey || e.metaKey;
    const selected = this.host.selection().ids;
    let ids: string[];
    let changed = false;
    if (selected.includes(hitId)) {
      ids = selected; // 已在选择集 → 整组移动
    } else if (additive) {
      ids = [...selected, hitId]; // Ctrl：加选（点击语义在 pointerup 由 handleClick 收口）
      changed = true;
    } else {
      ids = [hitId]; // 不在选择集 → 先选它再移动（拖拽提交时补报，短按点击走 handleClick）
      changed = true;
    }
    const ground = this.host.groundPoint(e.clientX, e.clientY);
    if (!ground) return false;
    const el = this.host.dom;
    const startPos = new Map<string, { x: number; z: number }>();
    for (const id of ids) {
      const pose = this.host.entryPose(id);
      if (pose) startPos.set(id, { x: pose.x, z: pose.z });
    }
    this.pendingMove = { ids, hitId, changed, additive, ground, startPos };
    // 批渲染：拖拽件临时摘出独立 mesh（松手由 finishPendingMove 归桶），避免逐帧回写实例矩阵
    this.host.beginMoveSolo(ids);
    if (this.host.mode() === '2d') this.host.set2dControlsEnabled(false);
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* 指针已释放（极快点击），忽略 */
    }
    return true;
  }

  private onPointerUp = (e: PointerEvent): void => {
    const start = this.downPos;
    this.downPos = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dragged = dx * dx + dy * dy > CLICK_SLOP_SQ;

    if (this.host.mode() === '3d') {
      // 复位左键默认动作（Ctrl+左键拖拽期间被临时切为 PAN，§10.3）
      this.host.set3dLeftButtonPan(false);
      // 右键：≤5px = 详情菜单（交互范式改版 §10.3）；右键拖拽不做动作（右键已从旋转中释放）
      if (e.button === 2) {
        if (!dragged) {
          const p = this.containerPoint(e.clientX, e.clientY);
          this.host.cb.onContextMenu?.(p.x, p.y, this.contextHit(e.clientX, e.clientY));
        }
        return;
      }
      if (e.button !== 0) return;
      // 组件直接拖拽结束：≤5px = 点击（选择 / 穿透），否则提交移动（2D 共用）
      if (this.pendingMove) {
        this.finishPendingMove(e, dragged);
        return;
      }
      if (dragged) {
        // 视为拖拽（中键旋转 / Ctrl+左键平移），不触发拾取；同时打断穿透连点链
        this.lastClick = null;
        return;
      }
      this.handleClick(e, e.ctrlKey || e.metaKey);
      return;
    }

    // ---- 2D ----
    // 右键：≤5px = 详情菜单（右键拖拽 = 平移，不出菜单）
    if (e.button === 2) {
      this.host.set2dControlsEnabled(true);
      if (!dragged) {
        const p = this.containerPoint(e.clientX, e.clientY);
        this.host.cb.onContextMenu?.(p.x, p.y, this.contextHit(e.clientX, e.clientY));
      }
      return;
    }
    if (e.button !== 0) return;

    // 框选结束 → 选区转世界 XZ 命中（core.rubberBandSelect，T2.4 遗留 / FR-M07）
    if (this.rubber) {
      const r = this.rubber;
      this.rubber = null;
      this.overlay.setRubber(null);
      this.host.set2dControlsEnabled(true);
      try {
        this.host.dom.releasePointerCapture(e.pointerId);
      } catch {
        /* 忽略 */
      }
      const rectEl = this.host.dom.getBoundingClientRect();
      const a = this.host.groundPoint(r.x0 + rectEl.left, r.y0 + rectEl.top);
      const b = this.host.groundPoint(r.x1 + rectEl.left, r.y1 + rectEl.top);
      if (a && b) {
        const ids = rubberBandSelect(this.host.components(), rect2D(a.x, a.z, b.x, b.z));
        // primary = 最后一个命中（属性面板 / 手柄跟随主选中，与 T2.4 同一口径）
        this.host.cb.onSelectChange(ids, ids.length > 0 ? ids[ids.length - 1] : null);
      }
      return;
    }

    // 组件直接拖拽结束：≤5px = 点击，否则提交移动（2D/3D 共用）
    if (this.pendingMove) {
      this.finishPendingMove(e, dragged);
      return;
    }
    // 空处点击（≤5px）→ 取消选择；拖拽结束（中键 / 右键平移）不触发拾取
    if (dragged) {
      this.lastClick = null;
      return;
    }
    this.handleClick(e, e.ctrlKey || e.metaKey);
  };

  /**
   * 组件直接拖拽收口（2D/3D 共用，交互范式改版）：
   * ≤5px = 点击（复用点击管线，含穿透选择 / 房间兜底）；
   * 否则整个选择集一起移动 = 单条 TransformComponentCommand = 单条撤销记录（FR-M08）。
   */
  private finishPendingMove(e: PointerEvent, dragged: boolean): void {
    const m = this.pendingMove;
    if (!m) return;
    this.pendingMove = null;
    if (this.host.mode() === '2d') this.host.set2dControlsEnabled(true);
    this.host.endMoveSolo(); // 拖拽件归回实例桶（≤5px 的点击路径也要归位，否则临时态永远挂着）
    try {
      this.host.dom.releasePointerCapture(e.pointerId);
    } catch {
      /* 忽略 */
    }
    if (!dragged) {
      // ≤5px = 点击（单选 / Ctrl 多选切换，复用 3D 点击管线，含穿透选择）
      this.handleClick(e, m.additive);
      return;
    }
    // 补报选择（按下时命中组件不在选择集）：Ctrl = 加选，否则 = 单选替换
    if (m.changed) {
      const sel = m.additive ? [...this.host.selection().ids, m.hitId] : [m.hitId];
      this.host.cb.onSelectChange(sel, m.hitId);
    }
    // 提交：整个选择集一起移动 = 单条 TransformComponentCommand = 单条撤销记录（FR-M08）
    const items: { id: string; after: { position: { x: number; y: number; z: number } } }[] = [];
    for (const id of m.ids) {
      const pose = this.host.entryPose(id);
      if (!pose) continue;
      items.push({ id, after: { position: { x: pose.x, y: pose.y, z: pose.z } } });
    }
    if (items.length > 0) this.host.cb.onTransformBatchCommit?.(items);
  }

  /**
   * 左键点击拾取（T2.4 / FR-M07）：
   * - 单击（≤5px）= 单选替换；
   * - Ctrl / Cmd + 单击 = 多选切换（点中已选组件则移出）；
   * - 同位置（≤5px）1s 内重复点击 = 点击穿透，沿射线逐层深入（到最深层再点回到最前）；
   * - 点空处 = 取消选择。
   * 选择集最终态上报应用层（渲染层不持有持久选择，store effect 会再同步回来）。
   */
  private handleClick(e: PointerEvent, additive: boolean): void {
    const hits = this.host.pickAll(e.clientX, e.clientY);
    const now = performance.now();

    if (!additive) {
      // 穿透：上一击同位、同目标、1s 内 → 层级 +1；否则从最前层重新开始
      const last = this.lastClick;
      let level = 0;
      if (
        last &&
        now - last.at <= CLICK_THROUGH_WINDOW_MS &&
        Math.abs(e.clientX - last.x) <= 5 &&
        Math.abs(e.clientY - last.y) <= 5 &&
        hits.length > 0 &&
        hits[0] === last.hits[0]
      ) {
        level = last.level + 1;
        if (level >= hits.length) level = 0;
      }
      this.lastClick = { x: e.clientX, y: e.clientY, at: now, level, hits };
      const id = hits.length > 0 ? hits[level] : null;
      if (!id) {
        // P5：没命中组件再兜底命中房间地板——房间从此是「可选中对象」，不再只是一张贴图
        const roomId = this.host.pickRoom(e.clientX, e.clientY);
        if (roomId) {
          this.host.cb.onSelectChange([], null);
          this.host.cb.onRoomClick?.(roomId);
          return;
        }
        this.host.cb.onRoomClick?.(null);
      }
      this.host.cb.onSelectChange(id ? [id] : [], id);
      return;
    }

    // Ctrl + 单击：多选切换（取最前命中）；点空处清空选择集
    const id = hits.length > 0 ? hits[0] : null;
    if (!id) {
      this.lastClick = null;
      this.host.cb.onRoomClick?.(null);
      this.host.cb.onSelectChange([], null);
      return;
    }
    this.lastClick = { x: e.clientX, y: e.clientY, at: now, level: 0, hits };
    const selected = this.host.selection().ids;
    const idx = selected.indexOf(id);
    const next = idx >= 0 ? selected.filter((x) => x !== id) : [...selected, id];
    const primary = idx >= 0 ? (next.length > 0 ? next[next.length - 1] : null) : id;
    this.host.cb.onSelectChange(next, primary);
  }

  /** 双击（T2.4 / §10.3「双击组件聚焦」）：优先聚焦当前主选中，否则聚焦最前命中 */
  private onDoubleClick = (e: MouseEvent): void => {
    const hits = this.host.pickAll(e.clientX, e.clientY);
    const primary = this.host.selection().primary;
    const id =
      primary && hits.includes(primary)
        ? primary
        : hits.length > 0
          ? hits[0]
          : null;
    this.host.cb.onDoubleClick?.(id);
  };

  private onPointerLeave = (): void => {
    this.lastCursor = null;
    this.host.cb.onCursorMove(null);
  };

  private onPointerMove = (e: PointerEvent): void => {
    const pt = this.host.groundPoint(e.clientX, e.clientY);

    // ---- 2D 框选橡皮筋（T2.6）：先于光标节流，防高倍缩放下预览冻结 ----
    if (this.host.mode() === '2d' && this.rubber) {
      const p = this.containerPoint(e.clientX, e.clientY);
      this.rubber.x1 = p.x;
      this.rubber.y1 = p.y;
      this.overlay.setRubber(this.rubber);
    }

    // 组件直接拖拽实时预览（2D/3D 共用，交互范式改版）：
    // 主选中（选择集末位）目标位置按网格吸附，其余组件同增量跟随（FR-M04 与放置 / 手柄同一约定）
    const m = this.pendingMove;
    if (m && pt) {
      const primary = m.ids[m.ids.length - 1];
      const s0 = m.startPos.get(primary);
      const p0 = this.host.entryPose(primary);
      if (s0 && p0) {
        let tx = s0.x + (pt.x - m.ground.x);
        let tz = s0.z + (pt.z - m.ground.z);
        if (this.host.snapEnabled() && this.host.snapStep() > 0) {
          const step = this.host.snapStep();
          tx = snapToGrid(tx, step);
          tz = snapToGrid(tz, step);
        }
        const fdx = tx - s0.x;
        const fdz = tz - s0.z;
        for (const id of m.ids) {
          const s = m.startPos.get(id);
          const pose = this.host.entryPose(id);
          if (!s || !pose) continue;
          const nx = s.x + fdx;
          const nz = s.z + fdz;
          this.host.moveEntry(id, nx, nz); // 拾取粗筛包围盒与实例矩阵一并跟随（T2.10f / T2.10h）
          this.host.refreshBox(id);
          if (id === this.host.selection().primary) {
            this.host.syncHandle(id, nx, nz); // 变换手柄（单选附着）跟随直接拖拽
          }
        }
        // 状态栏显示吸附后目标坐标（所见即所得，FR-M04，与变换手柄同一口径）
        this.host.cb.onTransformLive?.(primary, { position: { x: tx, y: p0.y, z: tz } });
      }
    }

    // 光标坐标（状态栏）：节流取整到 1mm，与上次相同则不回调
    this.emitCursor(pt);
  };
}
