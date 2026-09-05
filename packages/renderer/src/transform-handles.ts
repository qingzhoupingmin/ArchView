import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  snapAngle,
  snapToGrid,
  yawDegrees,
  yawQuaternion,
  type Component,
  type TransformFields,
} from '@archview/core';
import { VP_SELECTION } from '@archview/theme';

/**
 * 自研平面（2.5D）变换手柄（T2.3 / FR-M06 / 产品文档 §8.2-9）：
 * - XZ 平面移动（箭头指示；拖拽全程 2D，跟随网格吸附 FR-M04）
 * - Y 轴 90° 步进旋转（顶部圆弧 + 手柄点；任意角度输入走 T2.5 属性面板）
 * - w / d 非等比缩放（占地边缘手柄；直接写 size，scale 恒 (1,1,1)）
 *
 * 不采用 three.js TransformControls（三维手柄对机房顶视场景不直观，§8.2-9）。
 * 数据流：拖拽中只更新场景（onPreview，渲染层不反写 Document）；
 * 拖拽结束 onCommit → 应用层执行 TransformComponentCommand（单条撤销记录，FR-M08）。
 *
 * 手势接管：pointerdown 监听注册在 canvas 捕获阶段（先于 OrbitControls 与视口拾取），
 * 命中手柄时禁用 OrbitControls + stopImmediatePropagation，独占本次手势。
 */

export type HandleKind = 'move-x' | 'move-z' | 'rotate' | 'scale-w' | 'scale-d';

export interface TransformHandlesCallbacks {
  /** 拖拽实时预览：宿主更新场景（组件 group / 选中描边） */
  onPreview(fields: Partial<TransformFields>): void;
  /** 拖拽中通知应用层（状态栏实时坐标等，§10.1） */
  onLive?(fields: Partial<TransformFields>): void;
  /** 拖拽结束提交（应用层执行 TransformComponentCommand，FR-M08） */
  onCommit(fields: Partial<TransformFields>): void;
}

/** 缩放手柄的最小尺寸（mm）：防止拖过中心后尺寸坍缩 */
const MIN_SIZE = 100;

interface DragState {
  kind: HandleKind;
  pointerId: number;
  /** 拖拽开始时的组件状态（冻结基准，计算只依赖它 + 当前指针） */
  startPos: { x: number; y: number; z: number };
  startYaw: number;
  size: { w: number; d: number; h: number };
  /** 按下时指针在地面的世界坐标（移动拖拽的增量基准） */
  ground: { x: number; z: number } | null;
}

export class TransformHandles {
  private readonly scene: THREE.Scene;
  private camera: THREE.Camera;
  private readonly dom: HTMLElement;
  private controls: OrbitControls;
  private readonly cb: TransformHandlesCallbacks;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private root: THREE.Group | null = null;
  private hitTargets: THREE.Mesh[] = [];
  /** 缩放手柄组（拖拽中随 size 重定位，避免重建几何） */
  private scaleW: THREE.Group | null = null;
  private scaleD: THREE.Group | null = null;
  private comp: Component | null = null;
  private compId: string | null = null;
  private sizeKey = '';
  /** 网格吸附：0 = 关（宿主经 setSnap 传入当前开关 + 步长，FR-M04） */
  private snapStep = 0;
  private drag: DragState | null = null;
  private liveFields: Partial<TransformFields> = {};

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    dom: HTMLElement,
    controls: OrbitControls,
    cb: TransformHandlesCallbacks,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.dom = dom;
    this.controls = controls;
    this.cb = cb;
    // pointerdown 用捕获阶段：同一元素上捕获监听先于 OrbitControls / 视口拾取的冒泡监听执行
    dom.addEventListener('pointerdown', this.onPointerDown, true);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointercancel', this.onPointerUp);
  }

  /** 附着到选中组件（几何按 size 重建；同组件仅变换变化时只同步 transform） */
  attach(comp: Component): void {
    this.comp = comp;
    if (this.root && this.compId === comp.id) {
      if (this.sizeKey !== this.keyOf(comp)) this.rebuild(comp);
      else this.syncTo(comp);
      return;
    }
    this.rebuild(comp);
  }

  /** 同步 transform / 缩放手柄位置（拖拽预览与提交后复用） */
  syncTo(comp: Component): void {
    if (!this.root) return;
    this.root.position.set(comp.position.x, comp.position.y, comp.position.z);
    this.root.quaternion.set(comp.rotation.x, comp.rotation.y, comp.rotation.z, comp.rotation.w);
    if (this.scaleW) this.scaleW.position.x = comp.size.w / 2;
    if (this.scaleD) this.scaleD.position.z = comp.size.d / 2;
  }

  detach(): void {
    this.drag = null;
    this.liveFields = {};
    if (!this.root) return;
    this.scene.remove(this.root);
    this.disposeTree(this.root);
    this.root = null;
    this.hitTargets = [];
    this.scaleW = null;
    this.scaleD = null;
    this.comp = null;
    this.compId = null;
    this.dom.style.cursor = '';
  }

  dispose(): void {
    this.detach();
    this.dom.removeEventListener('pointerdown', this.onPointerDown, true);
    this.dom.removeEventListener('pointermove', this.onPointerMove);
    this.dom.removeEventListener('pointerup', this.onPointerUp);
    this.dom.removeEventListener('pointercancel', this.onPointerUp);
  }

  /** 网格吸附状态（FR-M04：G 开关 + 300/600/1200 步长，与放置管线同一约定） */
  setSnap(enabled: boolean, step: number): void {
    this.snapStep = enabled ? Math.max(step, 1) : 0;
  }

  /** 切换活动相机 / 控制器（T2.6 2D/3D 切换：拾取射线与手势接管跟随活动相机） */
  setActive(camera: THREE.Camera, controls: OrbitControls): void {
    this.camera = camera;
    this.controls = controls;
  }

  // ---------- 手势 ----------

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.root || !this.comp) return;
    const kind = this.pickHandle(e.clientX, e.clientY);
    if (!kind) return;
    const comp = this.comp;
    // 接管手势：捕获阶段先于 OrbitControls 执行 —— 禁用相机 + 阻断视口拾取 / downPos
    this.controls.enabled = false;
    e.stopImmediatePropagation();
    try {
      this.dom.setPointerCapture(e.pointerId);
    } catch {
      /* 指针已释放（极快点击），忽略 */
    }
    this.drag = {
      kind,
      pointerId: e.pointerId,
      startPos: { ...comp.position },
      startYaw: yawDegrees(comp.rotation),
      size: { ...comp.size },
      ground: this.groundPointAt(e.clientX, e.clientY),
    };
    this.liveFields = {};
    this.dom.style.cursor = 'grabbing';
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.drag) {
      // 悬停反馈（无按键时）：手柄可抓光标
      if (this.root && e.buttons === 0) {
        this.dom.style.cursor = this.pickHandle(e.clientX, e.clientY) ? 'grab' : '';
      }
      return;
    }
    const p = this.groundPointAt(e.clientX, e.clientY);
    if (!p) return;
    const d = this.drag;

    if (d.kind === 'move-x' || d.kind === 'move-z') {
      // XZ 平面移动：按下点到当前点的世界增量（全程 2D，箭头只是视觉指示）
      if (!d.ground) return;
      let x = d.startPos.x + (p.x - d.ground.x);
      let z = d.startPos.z + (p.z - d.ground.z);
      if (this.snapStep > 0) {
        x = snapToGrid(x, this.snapStep);
        z = snapToGrid(z, this.snapStep);
      }
      this.setLive({ position: { x, y: d.startPos.y, z } });
      return;
    }

    if (d.kind === 'rotate') {
      // Y 轴 90° 步进：指针方向（相对组件中心）的世界偏航 → 吸附
      const deg = (Math.atan2(p.x - d.startPos.x, p.z - d.startPos.z) * 180) / Math.PI;
      this.setLive({ rotation: yawQuaternion(snapAngle(deg)) });
      return;
    }

    // 缩放：指针在地面的位置投到组件局部轴 → 尺寸 = 2 × |投影|（size 单一事实源，§8.2-9）
    const rad = (d.startYaw * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const vx = p.x - d.startPos.x;
    const vz = p.z - d.startPos.z;
    if (d.kind === 'scale-w') {
      // 局部 +X 轴的世界方向 (cos, 0, -sin)
      const w = Math.max(MIN_SIZE, Math.round(2 * Math.abs(vx * cos - vz * sin)));
      this.setLive({ size: { ...d.size, w } });
    } else {
      // 局部 +Z 轴的世界方向 (sin, 0, cos)
      const dd = Math.max(MIN_SIZE, Math.round(2 * Math.abs(vx * sin + vz * cos)));
      this.setLive({ size: { ...d.size, d: dd } });
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    this.drag = null;
    this.controls.enabled = true;
    try {
      this.dom.releasePointerCapture(e.pointerId);
    } catch {
      /* 同上 */
    }
    this.dom.style.cursor = '';
    // 有变更才提交（纯点击手柄不产生历史条目）
    if (Object.keys(this.liveFields).length > 0) {
      this.cb.onCommit(this.liveFields);
    }
    this.liveFields = {};
  };

  private setLive(fields: Partial<TransformFields>): void {
    this.liveFields = fields;
    this.cb.onPreview(fields);
    this.cb.onLive?.(fields);
  }

  // ---------- 内部实现 ----------

  private pickHandle(clientX: number, clientY: number): HandleKind | null {
    this.setRay(clientX, clientY);
    const hits = this.raycaster.intersectObjects(this.hitTargets, false);
    if (hits.length === 0) return null;
    const kind = hits[0].object.userData.kind as HandleKind | undefined;
    return kind ?? null;
  }

  private setRay(clientX: number, clientY: number): void {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  private groundPointAt(clientX: number, clientY: number): { x: number; z: number } | null {
    this.setRay(clientX, clientY);
    const pt = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, pt);
    return hit ? { x: pt.x, z: pt.z } : null;
  }

  private keyOf(comp: Component): string {
    return `${comp.size.w}|${comp.size.d}|${comp.size.h}`;
  }

  private rebuild(comp: Component): void {
    this.detach();
    this.compId = comp.id;
    this.comp = comp;
    this.sizeKey = this.keyOf(comp);
    this.root = this.buildRoot(comp);
    this.scene.add(this.root);
  }

  /**
   * 手柄几何（组件局部坐标；root 的 position/quaternion 跟随组件）：
   * 移动箭头（贴地）+ 顶部旋转弧（90° 步进）+ w/d 边缘缩放块。
   * 可见体 + 不可见命中体（material.visible = false 仍可被 raycast，抓取面积更大）。
   */
  private buildRoot(comp: Component): THREE.Group {
    const root = new THREE.Group();
    root.position.set(comp.position.x, comp.position.y, comp.position.z);
    root.quaternion.set(comp.rotation.x, comp.rotation.y, comp.rotation.z, comp.rotation.w);

    const w = comp.size.w;
    const d = comp.size.d;
    const h = comp.size.h;

    const lineMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(VP_SELECTION),
      transparent: true,
      opacity: 0.95,
    });
    const knobMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(VP_SELECTION) });
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });

    // ---- 移动手柄：X / Z 两向箭头（贴地 y=40，避开网格 z-fighting） ----
    const reach = Math.max(w, d) * 0.5 + 1500;
    const arrows: Array<[HandleKind, number]> = [
      ['move-x', 0],
      // 局部 +X 经 Y 轴 -90° 映射到 +Z
      ['move-z', -Math.PI / 2],
    ];
    for (const [kind, rotY] of arrows) {
      const g = new THREE.Group();
      g.rotation.y = rotY;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(200, 40, 0),
          new THREE.Vector3(reach, 40, 0),
        ]),
        lineMat,
      );
      const cone = new THREE.Mesh(new THREE.ConeGeometry(200, 560, 12), knobMat);
      cone.rotation.z = -Math.PI / 2; // 圆锥默认 +Y → 指向 +X
      cone.position.set(reach + 280, 40, 0);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(reach + 700, 600, 600), hitMat);
      hit.position.set(reach / 2, 40, 0);
      hit.userData.kind = kind;
      g.add(line, cone, hit);
      root.add(g);
      this.hitTargets.push(hit);
    }

    // ---- 旋转手柄：组件顶部圆弧 + 前端手柄点（拖拽 → 90° 步进，FR-M06） ----
    const ringR = Math.max(w, d) * 0.5 + 900;
    const ringY = h + 900;
    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a) * ringR, ringY, Math.sin(a) * ringR));
    }
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), lineMat);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(240, 16, 12), knobMat);
    knob.position.set(0, ringY, ringR); // 组件「正面」（局部 +Z）方向
    const ringHit = new THREE.Mesh(new THREE.TorusGeometry(ringR, 400, 8, 48), hitMat);
    ringHit.rotation.x = Math.PI / 2; // 圆环放入 XZ 平面
    ringHit.position.y = ringY;
    ringHit.userData.kind = 'rotate';
    root.add(ring, knob, ringHit);
    this.hitTargets.push(ringHit);

    // ---- 缩放手柄：w（+X 边）/ d（+Z 边）边缘块（非等比，§8.2-9） ----
    const makeScale = (kind: HandleKind): THREE.Group => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(360, 700, 360), knobMat));
      const hit = new THREE.Mesh(new THREE.BoxGeometry(900, 900, 900), hitMat);
      hit.userData.kind = kind;
      g.add(hit);
      this.hitTargets.push(hit);
      return g;
    };
    this.scaleW = makeScale('scale-w');
    this.scaleW.position.set(w / 2, 350, 0);
    root.add(this.scaleW);
    this.scaleD = makeScale('scale-d');
    this.scaleD.position.set(0, 350, d / 2);
    root.add(this.scaleD);

    return root;
  }

  private disposeTree(obj: THREE.Object3D): void {
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
    for (const child of obj.children) this.disposeTree(child);
  }
}