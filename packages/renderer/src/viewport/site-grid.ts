/**
 * 场地环境层（架构拆分 Phase 2，自 `viewport.ts` 逐字迁出）
 *
 * 职责边界：**天空 + 光照 + 地面 + 双层网格 + 场地生长 + 阴影视锥**——
 * 这一层不认得「组件」，也不认得「房间」，只认得场景与尺寸，因此可独立测试、独立替换。
 * 唯一跨层的耦合点是 `gridDisplayStep()`（房间自带网格要与场地同格距），由门面以回调注入房间层。
 */
import * as THREE from 'three';
import { computeSiteSize, type Room } from '@archview/core';
import {
  VP_COMPONENT_DEFAULT,
  VP_GROUND,
  VP_HORIZON,
  VP_GRID,
  VP_GRID_MAJOR,
  VP_SKY_BOTTOM,
  VP_SKY_TOP,
} from '@archview/theme';
import { RENDER_ORDER, SITE_Y, applyRoomClip, makeRoomClipMaterial } from '../room-visuals';
import { GRID_LINE_BUDGET, GRID_MAJOR_EVERY, GROUND_SIZE, SITE_MARGIN } from './constants';

/** 天空盒：垂直渐变（极浅粉 → 白，§10.4） */
function makeSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, VP_SKY_TOP);
  grad.addColorStop(1, VP_SKY_BOTTOM);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * three 要求换 `shadowMap.enabled` 后所有材质 needsUpdate，
 * 否则着色器里的阴影分支不会重编译（开关失效，画面看不出来但预算没省）。
 */
function recompileShadows(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    if (Array.isArray(mat)) for (const m of mat) m.needsUpdate = true;
    else mat.needsUpdate = true;
  });
}

export class SiteGrid {
  private readonly scene: THREE.Scene;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly skyTexture: THREE.CanvasTexture;
  private readonly ground: THREE.Mesh;
  /** 场地描边：让地板边界在浅色视口里可读 */
  private readonly groundEdge: THREE.LineSegments;
  readonly dirLight: THREE.DirectionalLight;
  /** 房间裁剪刷共享材质：把房间占地写进 stencil（不写色不写深），场地网格据此丢弃 */
  readonly roomClipMaterial: THREE.MeshBasicMaterial;
  /** 双层网格：次网格给吸附格，主网格给尺度参照（§10.4） */
  private gridMinor: THREE.GridHelper | null = null;
  private gridMajor: THREE.GridHelper | null = null;
  /** 场地当前尺寸（mm）：随房间占地生长（P5 R1），基准 = GROUND_SIZE */
  private siteSize = GROUND_SIZE;
  /** 网格吸附状态（2D 直接拖拽与变换手柄共用同一约定，FR-M04） */
  private snapOn = true;
  private snapStep = 600;
  /** 阴影模式（T2.10a 性能模式最小版）：`off` = 关整条阴影通道 */
  private shadowOn = true;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.roomClipMaterial = makeRoomClipMaterial();
    this.skyTexture = makeSkyTexture();
    this.scene.background = this.skyTexture;

    // 光照（§10.4）：半球光（天空浅粉 / 地面浅灰）+ 单方向光
    const hemi = new THREE.HemisphereLight(
      new THREE.Color(VP_SKY_TOP),
      new THREE.Color(VP_COMPONENT_DEFAULT),
      1.0,
    );
    this.scene.add(hemi);
    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
    this.dirLight.position.set(14000, 20000, 8000);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.camera.left = -25000;
    this.dirLight.shadow.camera.right = 25000;
    this.dirLight.shadow.camera.top = 25000;
    this.dirLight.shadow.camera.bottom = -25000;
    this.dirLight.shadow.camera.near = 1000;
    this.dirLight.shadow.camera.far = 80000;
    this.dirLight.target.position.set(6000, 0, 6000);
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    // 地面 + 网格（600mm 模数，FR-M04）
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(VP_GROUND),
        roughness: 1,
        metalness: 0,
      }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // 场地描边：地板有了边界，配合更深的 --vp-ground 才形成「天空 / 地面」的分层
    this.groundEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE)),
      new THREE.LineBasicMaterial({ color: new THREE.Color(VP_HORIZON) }),
    );
    this.groundEdge.rotation.x = -Math.PI / 2;
    this.groundEdge.position.y = SITE_Y.edge;
    this.scene.add(this.groundEdge);

    this.rebuildSiteGrid();
  }

  /** 吸附开关（FR-M04：拖放 / 变换手柄 / 2D 直接拖拽共用同一约定） */
  get snap(): boolean {
    return this.snapOn;
  }

  /** 吸附步长（mm）——同时是次网格的目标格距 */
  get step(): number {
    return this.snapStep;
  }

  /** 当前场地尺寸（mm） */
  get size(): number {
    return this.siteSize;
  }

  /** 当前阴影模式 */
  get shadowMode(): 'on' | 'off' {
    return this.shadowOn ? 'on' : 'off';
  }

  /** 当前场地尺寸下实际画多少 mm 一条次网格线（超大场地按步长整数倍放大格距，守住线段预算） */
  gridDisplayStep(): number {
    const base = Math.max(this.snapStep, 100);
    if (this.siteSize / base <= GRID_LINE_BUDGET) return base;
    return Math.ceil(this.siteSize / (GRID_LINE_BUDGET * base)) * base;
  }

  /**
   * 设格距 / 吸附开关（FR-M04：网格密度 / 拖放 / 变换手柄 / 2D 直接拖拽共用同一吸附约定）。
   * 场地尺寸按步长整数倍量化，故步长变了要拿房间重算一遍。
   * ⚠️ 两层网格任何时候都要重画：步长 600→1200 时场地尺寸往往不变（1200 整除 36000），
   *    但 `gridDisplayStep()` 变了——不重画就会留着旧密度的网格（拆分时踩过的坑，别改回去）。
   * @returns 场地尺寸是否真的变化（门面据此决定要不要连带重画房间）
   */
  setStep(step: number, snap: boolean, rooms: Room[]): boolean {
    this.snapOn = snap;
    this.snapStep = step;
    const grew = this.applySiteSize(rooms);
    if (!grew) this.rebuildSiteGrid(); // applySiteSize 变化时已重建过，这里只补「尺寸没变」那一支
    return grew;
  }

  /**
   * 场地随房间占地生长（P5 R1）：无房间 = 基准 36000，与旧版逐像素一致。
   * 地面与描边用 scale 放大（几何不重建），网格必须重建——缩放会连带把格距也放大。
   */
  applySiteSize(rooms: Room[]): boolean {
    const need = computeSiteSize(rooms, {
      min: GROUND_SIZE,
      margin: SITE_MARGIN,
      quantum: Math.max(this.snapStep, 100),
    });
    if (need === this.siteSize) return false;
    this.siteSize = need;
    const k = need / GROUND_SIZE;
    this.ground.scale.set(k, k, 1);
    this.groundEdge.scale.set(k, k, 1);
    this.rebuildSiteGrid();
    this.resizeShadowFrustum();
    return true;
  }

  /** 网格显隐（§10.1 视口设置） */
  setVisible(visible: boolean): void {
    if (this.gridMinor) this.gridMinor.visible = visible;
    if (this.gridMajor) this.gridMajor.visible = visible;
  }

  /**
   * 开关整条阴影通道（T2.10a 性能模式最小版，开发计划 X5 / X9 的测量开关）：
   * 阴影 pass 的 draw call 与主 pass 同量级，关掉即省一半 calls。
   * @returns 真的换档才返回 true（门面据此回调应用层，保持「只在实际变化时触发」的旧语义）
   */
  setShadowMode(on: boolean): boolean {
    if (on === this.shadowOn) return false;
    this.shadowOn = on;
    this.renderer.shadowMap.enabled = on;
    recompileShadows(this.scene);
    this.dirLight.shadow.map?.dispose();
    this.dirLight.shadow.map = null;
    return true;
  }

  private makeGrid(step: number, colorHex: string, opacity: number, y: number): THREE.GridHelper {
    const divisions = Math.max(1, Math.round(this.siteSize / step));
    const color = new THREE.Color(colorHex);
    const grid = new THREE.GridHelper(this.siteSize, divisions, color, color);
    grid.position.y = y;
    grid.renderOrder = RENDER_ORDER.siteGrid;
    const mat = grid.material as THREE.Material;
    mat.transparent = true;
    mat.opacity = opacity;
    applyRoomClip(mat);
    this.scene.add(grid);
    return grid;
  }

  /** 重建两层场地网格（吸附步长或场地尺寸变化时） */
  private rebuildSiteGrid(): void {
    this.disposeGrid();
    const minor = this.gridDisplayStep();
    // 次网格贴地（y=2），主网格抬高 1mm 避免与之 z-fighting
    this.gridMinor = this.makeGrid(minor, VP_GRID, 0.85, SITE_Y.gridMinor);
    this.gridMajor = this.makeGrid(minor * GRID_MAJOR_EVERY, VP_GRID_MAJOR, 0.95, SITE_Y.gridMajor);
  }

  /** 阴影视锥跟着场地长大（P5 R5）：基准尺寸下仍取旧值 25000 / 80000，既有基线数值不变 */
  private resizeShadowFrustum(): void {
    const half = Math.max(25000, Math.round(this.siteSize * 0.7));
    const cam = this.dirLight.shadow.camera as THREE.OrthographicCamera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.far = Math.max(80000, this.siteSize * 3);
    cam.updateProjectionMatrix();
  }

  private disposeGrid(): void {
    for (const grid of [this.gridMinor, this.gridMajor]) {
      if (!grid) continue;
      this.scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
    }
    this.gridMinor = null;
    this.gridMajor = null;
  }

  /**
   * 释放本层持有的全部 GPU 资源：网格 / 地面 / 描边 / 天空纹理 / 裁剪刷材质 / 阴影贴图。
   * 不释放会随反复打开工程累积 GPU 内存（dispose 责任表 Phase 2 项）。
   */
  dispose(): void {
    this.disposeGrid();
    this.roomClipMaterial.dispose();
    this.scene.remove(this.ground);
    this.ground.geometry.dispose();
    (this.ground.material as THREE.Material).dispose();
    this.scene.remove(this.groundEdge);
    this.groundEdge.geometry.dispose();
    (this.groundEdge.material as THREE.Material).dispose();
    this.skyTexture.dispose();
    this.dirLight.shadow.map?.dispose();
  }
}