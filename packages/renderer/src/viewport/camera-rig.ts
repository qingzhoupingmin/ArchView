/**
 * 双相机运镜层（架构拆分 Phase 2，自 `viewport.ts` 逐字迁出）
 *
 * 职责边界：**透视 / 正交双相机 + 两套 OrbitControls + 运镜（预设 / 缩放 / 取景 / 复位）
 * + WASD 导航**。它不碰场景内容，也不知道「选中了什么」——
 * 2D 取景需要的内容包围盒由门面算好后传进来，手柄换相机由门面编排（§8.2-8）。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { footprintAABB, type Room } from '@archview/core';
import {
  HOME_OFFSET,
  HOME_TARGET,
  MAX_POLAR_DEG,
  ORTHO_FAR,
  ORTHO_HEIGHT,
  VIEW_SIZE_MAX,
  VIEW_SIZE_MIN,
  VIEW2D_HOME,
} from './constants';
import type { Entry, Fit2D, ViewMode, ViewportCallbacks, ViewPreset } from './types';

export class CameraRig {
  private readonly container: HTMLElement;
  private readonly cb: ViewportCallbacks;
  readonly camera: THREE.PerspectiveCamera;
  /** 2D 正交顶视相机（T2.6 / §8.2-8）：同一场景，拾取管线复用 */
  readonly ortho: THREE.OrthographicCamera;
  readonly controls: OrbitControls;
  /** 2D 控制器：禁旋转、左 / 中 / 右键均可平移，滚轮缩放走 ortho.zoom */
  readonly controls2d: OrbitControls;
  /** 当前视图模式（T2.6 / FR-V02）——由门面 `setViewMode` 落笔，其余各处只读 */
  mode: ViewMode = '3d';
  /** 2D 可视世界高度（mm）：进入 2D 时按内容取景设定，滚轮缩放走 ortho.zoom */
  private viewSize2d = VIEW2D_HOME.viewSize;
  /** 进入 2D 前保存的 3D 机位（切回 3D 恢复，往返不重建机位） */
  private saved3d: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  /** 初始观察距离（缩放百分比的分母，T2.7） */
  baseDistance = 0;
  /** 上一次相机回调时间戳（P2：10Hz 节流，罗盘不逐帧刷） */
  private lastCamAt = 0;
  /** WASD 当前按住的键（交互范式改版 §10.3）；RAF 每帧施加位移，不受按键重复触发影响 */
  private readonly navKeys = new Set<string>();
  /** WASD 期间 Shift 是否按住（2× 加速） */
  private navShift = false;
  /** WASD 开关（应用层在弹窗 / 菜单打开时关闭，避免误平移） */
  private navKeysEnabled = true;

  constructor(container: HTMLElement, renderer: THREE.WebGLRenderer, cb: ViewportCallbacks) {
    this.container = container;
    this.cb = cb;

    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    this.camera = new THREE.PerspectiveCamera(50, w / h, 10, 300000);
    // 初始机位 = 目标点 + HOME_OFFSET（与 resetView / iso 预设同一机位，T2.7 / §10.3）
    this.camera.position.set(
      HOME_TARGET[0] + HOME_OFFSET[0],
      HOME_TARGET[1] + HOME_OFFSET[1],
      HOME_TARGET[2] + HOME_OFFSET[2],
    );

    // 2D 正交顶视相机（T2.6 / §8.2-8）：up = -Z 使北向朝上（世界 +X → 屏幕右，世界 -Z → 屏幕上）
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, ORTHO_FAR);
    this.ortho.up.set(0, 0, -1);
    this.ortho.position.set(VIEW2D_HOME.x, ORTHO_HEIGHT, VIEW2D_HOME.z);

    // 视口控制（交互范式改版 §10.3：左键 = 选择 / 直接移动，中键拖拽 = 旋转，右键 = 详情菜单）：
    // 左键默认 null —— 空处左键拖拽不带动相机（WASD / Ctrl+左键拖拽是平移兜底，
    // Ctrl+左键在 pointerdown 临时切 PAN 生效，pointerup 复位）；右键从旋转中释放给详情菜单（§10.3）
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    // 滚轮缩放以光标位置为中心（T2.3 手感优化：盯着哪缩哪；three r160+ 内置）
    this.controls.zoomToCursor = true;
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null };
    // 视角下限（不允许把视角调到水平线以下）：旋转锁 0 ~ MAX_POLAR_DEG，
    // 平移改沿世界水平面（screenSpacePanning=false，同时与 WASD 导航口径一致），
    // 双保险杜绝相机 Y 变负。minPolarAngle 保持默认 0 —— top 预设需要正俯视。
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(MAX_POLAR_DEG);
    this.controls.screenSpacePanning = false;
    this.controls.target.set(HOME_TARGET[0], HOME_TARGET[1], HOME_TARGET[2]);
    this.controls.update();
    this.baseDistance = this.camera.position.distanceTo(this.controls.target);

    // 2D 控制器（交互范式改版 §10.3：左键选择 / 直接移动 / 框选 · 中键拖拽平移 · 右键详情菜单 / 平移 · 滚轮缩放）：
    // 相机控制只保留平移与缩放——左键默认 null（空处左键拖拽不带动相机，中键 / WASD 平移），
    // 组件拖拽 / 框选 / 点击由视口手势接管；右键拖拽平移（右键单击 = 详情菜单，由 pointerup 位移阈值区分）
    this.controls2d = new OrbitControls(this.ortho, renderer.domElement);
    this.controls2d.enableDamping = true;
    this.controls2d.dampingFactor = 0.08;
    this.controls2d.zoomToCursor = true;
    this.controls2d.enableRotate = false;
    this.controls2d.enablePan = true;
    this.controls2d.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls2d.minZoom = 0.02;
    this.controls2d.maxZoom = 400;
    this.controls2d.target.set(VIEW2D_HOME.x, 0, VIEW2D_HOME.z);
    this.controls2d.enabled = false;
    this.layoutOrtho();
  }

  /** 当前活动相机（T2.6：拾取 / 渲染 / 投影统一入口） */
  activeCamera(): THREE.Camera {
    return this.mode === '2d' ? this.ortho : this.camera;
  }

  /** 2D 取景：框住全部组件占地 + 房间（留 6m 边距）；空场景回退默认机位 */
  fit2D(entries: Iterable<Entry>, rooms: Room[]): Fit2D {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    let has = false;
    for (const entry of entries) {
      const r = footprintAABB(entry.comp.position, entry.comp.rotation, entry.comp.size);
      minX = Math.min(minX, r.xMin);
      minZ = Math.min(minZ, r.zMin);
      maxX = Math.max(maxX, r.xMax);
      maxZ = Math.max(maxZ, r.zMax);
      has = true;
    }
    for (const room of rooms) {
      minX = Math.min(minX, room.position.x - room.width / 2);
      minZ = Math.min(minZ, room.position.z - room.depth / 2);
      maxX = Math.max(maxX, room.position.x + room.width / 2);
      maxZ = Math.max(maxZ, room.position.z + room.depth / 2);
      has = true;
    }
    if (!has) {
      return { cx: VIEW2D_HOME.x, cz: VIEW2D_HOME.z, viewSize: VIEW2D_HOME.viewSize };
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, maxZ - minZ) + 6000;
    return { cx, cz, viewSize: Math.min(Math.max(span, VIEW_SIZE_MIN), VIEW_SIZE_MAX) };
  }

  /** 应用 2D 取景（进入 / 重置机位共用） */
  applyFit2D(fit: Fit2D): void {
    this.viewSize2d = fit.viewSize;
    this.layoutOrtho();
    this.ortho.position.set(fit.cx, ORTHO_HEIGHT, fit.cz);
    this.ortho.zoom = 1;
    this.controls2d.target.set(fit.cx, 0, fit.cz);
    this.controls2d.update();
  }

  /** 正交视锥：viewSize2d = 可视世界高度（mm），宽高比跟随容器；滚轮缩放走 ortho.zoom（视锥不变） */
  layoutOrtho(): void {
    const aspect =
      Math.max(this.container.clientWidth, 1) / Math.max(this.container.clientHeight, 1);
    const half = this.viewSize2d / 2;
    this.ortho.left = -half * aspect;
    this.ortho.right = half * aspect;
    this.ortho.top = half;
    this.ortho.bottom = -half;
    this.ortho.updateProjectionMatrix();
  }

  /** 缩放百分比（状态栏显示）：3D = 初始距离比；2D = 正交 zoom（1 = 100% = 进入时取景） */
  zoomPct(): number {
    if (this.mode === '2d') return this.ortho.zoom * 100;
    const dist = this.camera.position.distanceTo(this.controls.target);
    return this.baseDistance > 0 ? (this.baseDistance / dist) * 100 : 100;
  }

  /** 进入 2D 前存下当前 3D 机位（切回时原样恢复，确定性优先） */
  save3dPose(): void {
    this.saved3d = {
      pos: this.camera.position.clone(),
      target: this.controls.target.clone(),
    };
  }

  /** 恢复进入 2D 前保存的 3D 机位 */
  restore3dPose(): void {
    if (this.saved3d) {
      this.camera.position.copy(this.saved3d.pos);
      this.controls.target.copy(this.saved3d.target);
    }
    this.controls.update();
  }

  /** 视图预设（P2）：绕当前目标点重设机位（2D 下无预设机位，HUD 已隐藏入口） */
  setPreset(kind: ViewPreset): void {
    if (this.mode === '2d') return;
    const t = this.controls.target;
    const d = Math.min(Math.max(this.baseDistance, 2000), 60000);
    const presets: Record<ViewPreset, [number, number, number]> = {
      iso: [t.x + HOME_OFFSET[0], t.y + HOME_OFFSET[1], t.z + HOME_OFFSET[2]],
      top: [t.x + 0.001, t.y + d, t.z],
      front: [t.x, t.y + d * 0.18, t.z + d],
      side: [t.x + d, t.y + d * 0.18, t.z],
    };
    const p = presets[kind];
    this.camera.position.set(p[0], p[1], p[2]);
    this.controls.update();
    this.emitCamera();
  }

  /** 缩放（状态栏 ±）：factor > 1 为拉近（2D = 正交 zoom 等比放大） */
  zoomBy(factor: number): void {
    if (this.mode === '2d') {
      this.ortho.zoom = Math.min(
        Math.max(this.ortho.zoom * factor, this.controls2d.minZoom),
        this.controls2d.maxZoom,
      );
      this.cb.onZoom(this.zoomPct());
      return;
    }
    const t = this.controls.target;
    const dir = this.camera.position.clone().sub(t);
    const next = Math.min(Math.max(dir.length() / factor, 600), 200000);
    this.camera.position.copy(t).add(dir.setLength(next));
    this.controls.update();
  }

  /** 回到初始 3D 机位（= 构造器机位 = iso 预设，T2.7 同源约定） */
  reset3d(): void {
    this.controls.target.set(HOME_TARGET[0], HOME_TARGET[1], HOME_TARGET[2]);
    this.camera.position.set(
      HOME_TARGET[0] + HOME_OFFSET[0],
      HOME_TARGET[1] + HOME_OFFSET[1],
      HOME_TARGET[2] + HOME_OFFSET[2],
    );
    this.baseDistance = this.camera.position.distanceTo(this.controls.target);
    this.controls.update();
    this.emitCamera();
  }

  /** 把目标点对准到世界坐标（HUD「定位到选中组件」；2D = 平移到该点，保持缩放） */
  focusOn(x: number, y: number, z: number): void {
    if (this.mode === '2d') {
      this.controls2d.target.set(x, 0, z);
      this.ortho.position.set(x, ORTHO_HEIGHT, z);
      this.controls2d.update();
      return;
    }
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.set(x, y, z);
    this.camera.position.set(x + offset.x, y + offset.y, z + offset.z);
    this.controls.update();
  }

  /** 相机取景：对准 (cx, cz) 中心、按区域跨度 extent 自适应距离（大阵列场景载入后自动框选；仅 3D） */
  frameArea(cx: number, cz: number, extent: number): void {
    if (this.mode === '2d') return;
    const dist = Math.max(extent * 1.8, 5000);
    this.controls.target.set(cx, 0, cz);
    this.camera.position.set(cx + dist * 0.65, dist * 0.5, cz + dist * 0.85);
    this.baseDistance = this.camera.position.distanceTo(this.controls.target);
    this.controls.update();
    this.emitCamera();
  }

  /** 相机朝向回调（P2 HUD 罗盘）：方位角 / 极角，10Hz 节流由 animate 侧控制 */
  emitCamera(): void {
    if (!this.cb.onCamera) return;
    const off = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    this.cb.onCamera(THREE.MathUtils.radToDeg(sph.theta), THREE.MathUtils.radToDeg(sph.phi));
  }

  /** 10Hz 相机回调节流判定（门面 animate 每帧问一次） */
  shouldEmitCamera(now: number): boolean {
    if (now - this.lastCamAt <= 100) return false;
    this.lastCamAt = now;
    return true;
  }

  /** WASD 平移开关（应用层在弹窗 / 菜单打开时关闭，避免按键误平移） */
  setNavKeysEnabled(enabled: boolean): void {
    this.navKeysEnabled = enabled;
    if (!enabled) {
      this.navKeys.clear();
      this.navShift = false;
    }
  }

  /** 本帧 WASD 位移（RAF 循环内、控制器 update 之前调用；dt 单位秒） */
  applyNavPan(dt: number): void {
    if (this.navKeys.size === 0 || dt <= 0) return;
    if (this.mode === '2d') {
      // 顶视：屏幕上 = -Z（北向朝上），左 = -X —— WASD = 屏幕上下左右（固定轴）
      let mx = 0;
      let mz = 0;
      if (this.navKeys.has('w')) mz -= 1;
      if (this.navKeys.has('s')) mz += 1;
      if (this.navKeys.has('a')) mx -= 1;
      if (this.navKeys.has('d')) mx += 1;
      const l = Math.hypot(mx, mz);
      if (l === 0) return;
      const speed = Math.max(1500, this.viewSize2d * 0.6) * (this.navShift ? 2 : 1);
      const dx = (mx / l) * speed * dt;
      const dz = (mz / l) * speed * dt;
      this.ortho.position.x += dx;
      this.ortho.position.z += dz;
      this.controls2d.target.x += dx;
      this.controls2d.target.z += dz;
      return;
    }
    // 3D：相机前向投影到 XZ 地面 = 屏幕前向；右向 = 前向 × 上向量
    let fx = this.controls.target.x - this.camera.position.x;
    let fz = this.controls.target.z - this.camera.position.z;
    const fl = Math.hypot(fx, fz);
    if (fl < 1) {
      // 相机几乎正对 target 正上方（顶视预设等）：退化为 2D 口径（W = -Z 北向）
      fx = 0;
      fz = -1;
    } else {
      fx /= fl;
      fz /= fl;
    }
    const rx = -fz;
    const rz = fx;
    let mx = 0;
    let mz = 0;
    if (this.navKeys.has('w')) {
      mx += fx;
      mz += fz;
    }
    if (this.navKeys.has('s')) {
      mx -= fx;
      mz -= fz;
    }
    if (this.navKeys.has('d')) {
      mx += rx;
      mz += rz;
    }
    if (this.navKeys.has('a')) {
      mx -= rx;
      mz -= rz;
    }
    const l = Math.hypot(mx, mz);
    if (l === 0) return;
    const dist = this.camera.position.distanceTo(this.controls.target);
    const speed = Math.max(1500, dist * 0.8) * (this.navShift ? 2 : 1);
    const dx = (mx / l) * speed * dt;
    const dz = (mz / l) * speed * dt;
    // 相机与 target 同向量平移 = pan（与 OrbitControls 内部 _pan 同原理，阻尼状态保持一致）
    this.camera.position.x += dx;
    this.camera.position.z += dz;
    this.controls.target.x += dx;
    this.controls.target.z += dz;
  }

  /**
   * WASD 移动画布（交互范式改版 §10.3）：W/A/S/D 平移视口，Shift 2× 加速。
   * - keydown/keyup 维护按住键集合，RAF 每帧按 dt 施加位移（平滑、不受按键重复触发影响）；
   * - 3D = 相机前向投影到 XZ 地面（屏幕相对方向）；2D = 顶视固定轴（屏幕上 = -Z 北向）；
   * - 速度随相机距离 / 可视范围增大（远快近慢），下限保证近处不蠕行；
   * - 输入框聚焦时忽略（与 shortcuts.ts 同一守卫）；窗口失焦清空按键集合（防卡键）。
   */
  private onNavKeyDown = (e: KeyboardEvent): void => {
    this.navShift = e.shiftKey;
    // Ctrl / Meta / Alt 组合留给浏览器（Ctrl+W 关页、Alt 菜单等）；Shift = 加速，放行
    if (!this.navKeysEnabled || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 'a' || k === 's' || k === 'd') this.navKeys.add(k);
  };

  private onNavKeyUp = (e: KeyboardEvent): void => {
    this.navShift = e.shiftKey;
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 'a' || k === 's' || k === 'd') this.navKeys.delete(k);
  };

  private onNavBlur = (): void => {
    this.navKeys.clear();
    this.navShift = false;
  };

  /** 绑定 window 级按键跟踪（构造末期与 dispose 配对） */
  bindNavKeys(): void {
    window.addEventListener('keydown', this.onNavKeyDown);
    window.addEventListener('keyup', this.onNavKeyUp);
    window.addEventListener('blur', this.onNavBlur);
  }

  /** 解绑（dispose 内先解绑，再拆相机与控制器） */
  unbindNavKeys(): void {
    window.removeEventListener('keydown', this.onNavKeyDown);
    window.removeEventListener('keyup', this.onNavKeyUp);
    window.removeEventListener('blur', this.onNavBlur);
  }

  /** 相机自动环绕（S2.0d 性能基线）：采样「相机运动」负载下的 fps */
  setAutoRotate(on: boolean, speed = 2.0): void {
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = speed;
  }

  dispose(): void {
    this.unbindNavKeys();
    this.controls.dispose();
    this.controls2d.dispose();
  }
}

