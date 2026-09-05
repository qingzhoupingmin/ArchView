import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type {
  Component,
  ComponentType,
  LodLevel,
  LodPolicy,
  LodRule,
  Room,
  TransformFields,
} from '@archview/core';
import { placePrimitive, visiblePrims, yawDegrees } from '@archview/core';
import { VP_SELECTION } from '@archview/theme';

import { BatchLayer, type BatchingMode } from './instancing';
import { TransformHandles } from './transform-handles';
import { Overlay2D, type ComponentAnnotation, type RoomAnnotation } from './overlay2d';
import { resolveCaptureScale } from './capture';
// 协作者（视口拆分 Phase 2 / 3）：门面是唯一的装配者，允许依赖全部协作者
import { CameraRig } from './viewport/camera-rig';
import { SiteGrid } from './viewport/site-grid';
import { AssetRegistry } from './viewport/assets';
import { EntryStore } from './viewport/entry-store';
import { LodController } from './viewport/lod-controller';
import { RoomLayer } from './viewport/room-layer';
import { InteractionManager } from './viewport/interaction';

// ============================================================
// 类型契约 / 常量 / 拾取纯函数已在 Phase 1 拆到 ./viewport/* 子模块：
//   ./viewport/types      —— 对外事件协议（ViewportCallbacks 等）+ 场景对象结构（Entry / RoomEntry）
//   ./viewport/constants  —— 场地 / 相机 / 机位 / 检测节拍等硬参数（每一条取值都有踩坑出处）
//   ./viewport/picking    —— 双路拾取纯函数（不依赖 DOM，node 环境可单测）
// 门面 viewport.ts 从此只保留「装配 + 跨块编排 + public API」，见视口拆分施工总图。
// ============================================================
import type {
  Entry,
  ShadowMode,
  ViewMode,
  ViewportCallbacks,
  ViewPreset,
} from './viewport/types';
import { pickHits } from './viewport/picking';





/**
 * three.js 视口（T0.6 / FR-V01 / FR-V09）：
 * - 粉白浅色视口：渐变天空盒 + 半球光 + 单方向光（PCFSoft 软阴影 2048，§10.4）
 * - 交互（交互范式改版 §10.3）：左键点击选择（移动 ≤5px 才算点击；拖组件 = 直接移动，2D/3D 同语义）·
 *   中键拖拽旋转（3D）/ 平移（2D）· 右键详情菜单 · WASD 移动画布（Shift 加速，应用层可关）·
 *   滚轮缩放（zoomToCursor 以光标为中心）· Ctrl+左键点击多选 · Ctrl+左键拖拽平移（无中键兜底）
 * - 增量同步：componentId → Object3D 缓存（§8.2-2），避免全量重建
 */
export class Viewport3D {
  private readonly container: HTMLElement;
  private readonly cb: ViewportCallbacks;
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  /** 双相机运镜层（Phase 2）：透视 / 正交双相机 + 两套 OrbitControls + 运镜 + WASD 导航 */
  private readonly rig: CameraRig;
  /** 场地环境层（Phase 2）：天空 / 光照 / 地面 / 双层网格 / 场地生长 / 阴影视锥 */
  private readonly site: SiteGrid;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  /** 2D 覆盖层（T2.6）：橡皮筋 + 尺寸标注（SVG，不进场景图） */
  private readonly overlay: Overlay2D;
  /** 房间图层（Phase 4 / T2.8）：房间是独立于组件的另一套场景对象，全量对账 */
  private readonly layer: RoomLayer;
  /** 手势层（Phase 4 / §10.3）：直接拖拽 / 框选橡皮筋 / 穿透连点三条状态机 */
  private readonly fx: InteractionManager;
  private readonly resizeObserver: ResizeObserver;
  private selectionBoxes = new Map<string, THREE.BoxHelper>();
  /** 共享资源工厂（Phase 3）：几何缓存 + 材质工厂，全视口一份 */
  private readonly assets: AssetRegistry;
  /**
   * 组件显示条目仓库（Phase 3）：componentId → Entry 增量缓存（§8.2-2）
   * ＋ T2.10g 双路（独立 mesh / 实例桶）的唯一持有者。
   */
  private readonly store: EntryStore;
  /** LOD 双档控制器（Phase 3 / T2.12）：档位状态 + 何时该换档 */
  private readonly lod: LodController;
  /** 变换手柄（T2.3 / FR-M06 / §8.2-9）：仅单选时附着；构造器中初始化 */
  private handles!: TransformHandles;
  /** 拖放预览幽灵（T2.2）：类型变化才重建几何，位置变化只移动（dragover 高频触发） */
  private dragGhost: {
    group: THREE.Group;
    material: THREE.MeshStandardMaterial;
    typeId: string;
  } | null = null;
  /** 选择集（T2.4 / FR-M07：多选，每个选中组件一条描边） */
  private selectedIds: string[] = [];
  /** 主选中 = 最后点击的（属性面板 / 变换手柄 / 聚焦用） */
  private primaryId: string | null = null;
  private rafId = 0;
  private disposed = false;
  /** 上一帧时间戳（WASD 位移 dt 用；钳制防止切 tab 回来大跳） */
  private lastFrameAt = performance.now();
  private frames = 0;
  private lastFpsAt = performance.now();

  // ---------- Phase 2 只读转发：相机 / 运镜归属 CameraRig，场地归属 SiteGrid ----------
  // 门面内部原本 150+ 处 `this.camera / this.controls / this.mode` 引用保持零改写，
  // 拆分风险因此被压到「搬家的那几十个方法」之内，而不是散落在整个文件。
  private get camera(): THREE.PerspectiveCamera {
    return this.rig.camera;
  }
  private get ortho(): THREE.OrthographicCamera {
    return this.rig.ortho;
  }
  private get controls(): OrbitControls {
    return this.rig.controls;
  }
  private get controls2d(): OrbitControls {
    return this.rig.controls2d;
  }
  /** 当前视图模式（T2.6 / FR-V02）：只读转发，唯一写点是 `setViewMode` 落笔到 CameraRig */
  private get mode(): ViewMode {
    return this.rig.mode;
  }
  /** 房间数据只读转发（2D 取景与尺寸标注都要读它；写入一律走 RoomLayer.sync） */
  private get rooms(): Room[] {
    return this.layer.rooms;
  }
  // ---------- Phase 3 只读转发：条目仓库 / 批渲染层 / 批开关 / LOD 档位 ----------
  /** 条目映射：写入只发生在 EntryStore 内部，门面这里只读与遍历（拾取粗筛 / 取景 / 标注） */
  private get entries(): Map<string, Entry> {
    return this.store.entries;
  }
  private get batch(): BatchLayer {
    return this.store.batch;
  }
  private get batching(): BatchingMode {
    return this.store.batching;
  }
  private get lodMode(): LodLevel {
    return this.lod.mode;
  }

  constructor(container: HTMLElement, cb: ViewportCallbacks) {
    this.container = container;
    this.cb = cb;

    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);

    // 渲染器：antialias 开启、DPR 上限 2（FR-V09）
    this.renderer = new THREE.WebGLRenderer({
      // P5：stencil 缓冲供场地网格裁剪用——three 默认 false，必须显式开
      stencil: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // 双相机运镜层（Phase 2 / CameraRig）：透视 + 2D 正交，两套 OrbitControls 与运镜参数一体
    this.rig = new CameraRig(container, this.renderer, cb);
    // 场地环境层（Phase 2 / SiteGrid）：天空盒 + 光照 + 地面描边 + 双层网格（600mm 模数，FR-M04）
    this.site = new SiteGrid(this.scene, this.renderer);

    // 共享资源工厂（Phase 3）：几何 / 材质在全场景只存在一份
    this.assets = new AssetRegistry();
    // LOD 双档控制器（Phase 3）：只决定「该换档了吗」，换档的代价（全场景重建）交回门面编排
    this.lod = new LodController({
      rebuildAll: () => this.rebuildAllEntries(),
      onLod: (mode) => this.cb.onLod?.(mode),
      distance: () =>
        this.rig.mode === '3d'
          ? this.rig.camera.position.distanceTo(this.rig.controls.target)
          : Infinity,
      viewMode: () => this.rig.mode,
    });
    // 组件条目仓库（Phase 3）：内含实例化批渲染层，常驻场景图，桶为空时不产生任何 draw call
    this.store = new EntryStore(this.scene, this.assets, {
      isSelected: (id) => this.selectedIds.includes(id),
      lodMode: () => this.lod.mode,
    });
    // 房间图层（Phase 4）：三条跨块依赖全部以回调注入，不许横向 import
    this.layer = new RoomLayer(this.scene, {
      gridStep: () => this.site.gridDisplayStep(),
      clipMaterial: () => this.site.roomClipMaterial,
      frameArea: (cx, cz, extent) => this.rig.frameArea(cx, cz, extent),
    });

    // 2D 覆盖层（T2.6）：SVG 追加在 canvas 之后，z-index 低于 HUD
    this.overlay = new Overlay2D(container);
    this.overlay.resize(w, h);
    this.overlay.hide();

    // 变换手柄（T2.3 / FR-M06 / §8.2-9）：自研 2.5D 手柄（XZ 移动 / Y 轴 90° 旋转 / w-d 非等比缩放）。
    // 拖拽中仅更新场景预览（不反写 Document），提交由应用层执行 TransformComponentCommand。
    this.handles = new TransformHandles(
      this.scene,
      this.camera,
      this.renderer.domElement,
      this.controls,
      {
        onPreview: (fields) => this.applyTransformPreview(fields),
        onLive: (fields) => {
          if (this.primaryId) this.cb.onTransformLive?.(this.primaryId, fields);
        },
        onCommit: (fields) => {
          if (this.primaryId) this.cb.onTransformCommit?.(this.primaryId, fields);
        },
      },
    );

    // 场地网格 / 吸附初值（600mm 模数，FR-M04）：网格本体已由 SiteGrid 在构造时建好，
    // 这里只走一次门面编排，把手柄吸附口径一并落定
    this.setGridStep(600);



    // 手势层（Phase 4）：它只认这张宿主接口——拾取、位姿写入、描边刷新一律由门面就地供给，
    // 于是「拖拽 / 框选 / 穿透」这套状态机终于能与「场景怎么搭」彻底解耦
    this.fx = new InteractionManager(
      {
        cb: this.cb,
        dom: this.renderer.domElement,
        mode: () => this.rig.mode,
        selection: () => ({ ids: this.selectedIds, primary: this.primaryId }),
        pickAll: (x, y) => this.pickAll(x, y),
        pickRoom: (x, y) => this.pickRoom(x, y),
        groundPoint: (x, y) => this.groundPoint(x, y),
        components: () => [...this.entries.values()].map((en) => en.comp),
        entryPose: (id) => {
          const en = this.entries.get(id);
          if (!en) return undefined;
          return { x: en.group.position.x, y: en.group.position.y, z: en.group.position.z };
        },
        moveEntry: (id, x, z) => {
          const en = this.entries.get(id);
          if (en) this.store.movePose(en, x, z);
        },
        refreshBox: (id) => this.selectionBoxes.get(id)?.update(),
        syncHandle: (id, x, z) => {
          const en = this.entries.get(id);
          if (!en) return;
          this.handles.syncTo({ ...en.comp, position: { x, y: en.comp.position.y, z } });
        },
        beginMoveSolo: (ids) => this.store.beginMoveSolo(ids),
        endMoveSolo: () => this.store.endMoveSolo(),
        snapEnabled: () => this.site.snap,
        snapStep: () => this.site.step,
        set2dControlsEnabled: (on) => {
          this.controls2d.enabled = on;
        },
        set3dLeftButtonPan: (on) => {
          this.controls.mouseButtons.LEFT = on ? THREE.MOUSE.PAN : null;
        },
      },
      this.overlay,
    );
    // pointerdown 由手势层注册在捕获阶段：先于 OrbitControls 的冒泡监听执行，
    // 「Ctrl+左键 = 平移」的临时 mouseButtons 修改才能对当前手势生效（pointerup 复位）
    this.fx.bind();
    // WASD 移动画布（交互范式改版 §10.3）：window 级按键跟踪，RAF 每帧施加位移（Phase 2 归 CameraRig）
    this.rig.bindNavKeys();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.animate();
  }

  // ---------- 组件同步（§8.2-2，图形落在 EntryStore） ----------

  /**
   * 增量同步一个组件（§8.2-2）：建条目 / 换类型 / 改色 / 换档位的判断都在 EntryStore，
   * 门面只补一句跨块编排——选中件的描边必须跟着新 group 重算（T2.12 遗留缺陷的收口）。
   */
  addOrUpdate(comp: Component, type: ComponentType): void {
    this.store.addOrUpdate(comp, type);
    this.selectionBoxes.get(comp.id)?.update();
  }

  /** 摘掉一个组件的显示条目；选择集同步剔除是门面的编排职责（T2.4） */
  remove(id: string): void {
    if (!this.store.remove(id)) return;
    // 选择集同步剔除（T2.4）：被删组件若在选中集内，主选中顺延到集合末尾
    if (this.selectedIds.includes(id)) {
      const next = this.selectedIds.filter((x) => x !== id);
      const primary =
        this.primaryId === id ? (next.length > 0 ? next[next.length - 1] : null) : this.primaryId;
      this.select(next, primary);
    }
  }

  /** 清空全部条目（选择集已由调用方收口，故不必逐个走 remove） */
  clear(): void {
    this.store.clear();
  }

  // ---------- LOD 双档（S2.5 / T2.12，档位状态在 LodController） ----------

  /**
   * 切换 LOD 档位（底层入口）。图元集合随档位变化 ⇒ 必须重建全部组件图形，
   * 而重建还牵扯描边与选择集，所以 LodHost.rebuildAll 回调回落到门面的 rebuildAllEntries。
   */
  setLodMode(mode: LodLevel): void {
    this.lod.setMode(mode);
  }

  /**
   * 全场景图形重建（LOD 升降档 / 批渲染开关共用）——门面的跨块编排。
   *
   * 描边必须一起重建：BoxHelper 持有的是**旧 group 的引用**，而重建会换新 group——
   * 只调 box.update() 会对着一个已被清空的旧容器算包围盒，选中框当场塌成一个点
   * （T2.12 遗留缺陷，本次合批接线时一并收口）。
   */
  private rebuildAllEntries(): void {
    const snapshot = [...this.entries.values()].map((e) => ({ comp: e.comp, type: e.type }));
    const selected = [...this.selectedIds];
    const primary = this.primaryId;
    this.select([], null); // 先释放描边与手柄附着，再重建（否则会更新到旧 group 上）
    for (const item of snapshot) this.store.disposeEntry(item.comp.id);
    for (const item of snapshot) this.addOrUpdate(item.comp, item.type);
    this.select(selected, primary);
  }

  // ---------- 批渲染开关（S2.5 / T2.10g、§B-2「双路并存」） ----------

  /** 当前批渲染开关 */
  getBatching(): BatchingMode {
    return this.batching;
  }

  /**
   * 开关实例化批渲染（T2.10g / T2.10h 的验收入口）：桶的可见性与清空落在 EntryStore，
   * 而两档之间画面必须逐像素一致，所以换档是**全量重建**而不是增量迁移——由门面编排。
   */
  setBatching(mode: BatchingMode): void {
    if (mode === this.batching) return;
    this.store.setBatching(mode);
    this.rebuildAllEntries();
    this.cb.onBatching?.(mode);
  }

  /** 批渲染读数（桶数 ≈ 单通道 draw call），`/fps` 基线页与状态栏共用 */
  getBatchStats(): { buckets: number; instances: number; capacity: number } {
    return this.batch.getStats();
  }

  // ---------- 性能模式（S2.5 / T2.10a：阴影通道开关） ----------

  /** 当前阴影模式 */
  getShadowMode(): ShadowMode {
    return this.site.shadowMode;
  }

  /**
   * 开关整条阴影通道（T2.10a 性能模式最小版，开发计划 X5 / X9 的测量开关）：
   * 阴影 pass 的 draw call 与主 pass 同量级，关掉即省一半 calls。
   * 落地在 SiteGrid（它持有 dirLight 与 renderer.shadowMap），门面只在真的换档后回调应用层。
   */
  setShadowMode(mode: ShadowMode): void {
    if (this.site.setShadowMode(mode === 'on')) this.cb.onShadowMode?.(mode);
  }

  /** 当前实际渲染的档位（供应用层显示与单测断言） */
  getLodMode(): LodLevel {
    return this.lod.mode;
  }

  /** 当前升降档策略：auto / far / near 三态 */
  getLodPolicy(): LodPolicy {
    return this.lod.currentPolicy;
  }

  /** 设策略并立即生效一次（不必等下个检测节拍） */
  setLodPolicy(policy: LodPolicy): void {
    this.lod.setPolicy(policy);
  }

  /** 覆盖升降档阈值（mm）；退档线自动保证 ≥ 升档线 + 迟滞带（core normalizeLodRule 负责归一化） */
  setLodRule(rule: Partial<LodRule>): void {
    this.lod.setRule(rule);
  }

  getLodRule(): LodRule {
    return this.lod.currentRule;
  }

  /**
   * **出图升档**（FR-V07 截图 / FR-V05 漫游 / FR-V08 视频的接线口）：
   * 临时升档 → 同步执行 fn → 无条件恢复，编辑视口的帧率预算不受出图影响。
   */
  withForcedLod<T>(mode: LodLevel, fn: () => T): T {
    return this.lod.withForced(mode, fn);
  }

  /**
   * 出图（T3.5 / FR-V07）：按 scale 倍分辨率重画一帧并读回 PNG dataURL。
   *
   * 三条约束都来自 WebGL 的现实行为，不是风格偏好：
   * ① **不开 preserveDrawingBuffer**：那会让合成器每帧保留整张缓冲，编辑视口白付这份
   *    内存与带宽；改为「渲染完在**同一帧内** toDataURL」——官方推荐的截图路径。
   * ② **只放大 pixelRatio、不动 CSS 尺寸**：改宽高会连带透视相机 aspect 与 2D 正交相机
   *    的取景范围一起漂（顶视会忽然多画一圈或裁掉一圈）；而 setPixelRatio 只放大绘图缓冲、
   *    画面内容逐像素不变 ⇒ 2D / 3D 两种相机都天然正确，不必各自处理投影。
   * ③ **必须走 withForcedLod('near', …)**：far 档下细节件压根不在场景里，截图会得到灰盒
   *    ——这正是 T2.12 预留该钩子的用途。
   *
   * @returns PNG dataURL；返回 null 表示没拿到有效图像（尺寸为 0 / 上下文丢失 / 空 dataURL），
   *   调用方须给出提示——**静默产出一张黑图比报错更糟**。
   */
  captureImage(scale = 2): string | null {
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    const prevRatio = this.renderer.getPixelRatio();
    // 现有 DPR 上限是 2（FR-V09），出图倍率乘在其上；边长超限时 resolveCaptureScale 自动降档
    const ratio = prevRatio * resolveCaptureScale(w, h, scale);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false); // false：不去改 canvas 的 CSS 样式，视口不会在屏幕上变大
    try {
      return this.lod.withForced('near', () => {
        this.renderer.render(this.scene, this.activeCamera());
        const url = this.renderer.domElement.toDataURL('image/png');
        // 空 dataURL / 'data:,' 是上下文丢失时的典型表现，此时宁可报失败
        return url && url.length > 'data:,'.length ? url : null;
      });
    } catch {
      return null; // toDataURL 在部分浏览器对超大画布直接抛 SecurityError / 内存错
    } finally {
      this.renderer.setPixelRatio(prevRatio);
      this.renderer.setSize(w, h, false);
      // 立刻按正常分辨率补出一帧：否则用户在恢复前的那一帧里会看到被拉伸的出图残影
      this.renderer.render(this.scene, this.activeCamera());
    }
  }

  /**
   * 选择集 / 拖拽临时态 → 双路对账（T2.10g）：该进桶的进桶、该摘出的摘出。
   * @returns 真的换了路的组件数（0 = 无变化）
   */
  private syncSoloStates(): number {
    return this.store.syncSoloStates();
  }



  // ---------- 房间同步（T2.8，产品文档 §8.2-10） ----------

  /**
   * 房间全量同步：半透明地板（粉色，标出「这是房间」）+ 线框轮廓（高度感）。
   * 尺寸 / 位置 / 楼层变化（key 指纹不一致）时销毁重建几何，避免残留旧尺寸。
   */
  syncRooms(rooms: Room[]): void {
    // 场地先随房间生长，再画房间（房间自带网格要用新格距）
    this.site.applySiteSize(rooms);
    this.layer.sync(rooms);
  }

  // ---------- 2D / 3D 视图切换（T2.6 / FR-V02 / FR-V03 / §8.2-8） ----------

  /**
   * 视图模式切换：同场景双相机（§8.2-8），选择 / 变换 / 属性共享。
   * - 2D：正交顶视相机；进入时按内容自适应取景（空场景 = 默认机位）；
   * - 3D：恢复进入 2D 前保存的机位（往返切换不重建机位，确定性优先）。
   */
  setViewMode(mode: ViewMode): void {
    if (mode === this.rig.mode) return;
    this.rig.mode = mode;
    // 切模式时进行中的拖拽 / 框选手势一并收尾（极端情况：Tab 在拖拽中被按下）
    this.fx.cancelGestures();

    if (mode === '2d') {
      this.rig.save3dPose(); // 保存 3D 机位（切回时恢复）
      // 按内容自适应取景（与 /fps 页 frameArea 同一「框住内容」语义）：
      // 内容包围盒要同时看组件占地与房间，故由门面把两份数据一起递给 CameraRig
      this.rig.applyFit2D(this.rig.fit2D(this.entries.values(), this.rooms));
      this.controls.enabled = false;
      this.controls2d.enabled = true;
      this.handles.setActive(this.ortho, this.controls2d);
      this.overlay.show();
    } else {
      this.controls2d.enabled = false;
      this.controls.enabled = true;
      this.rig.restore3dPose();
      this.handles.setActive(this.camera, this.controls);
      this.overlay.hide();
      this.rig.emitCamera();
    }
    this.cb.onZoom(this.rig.zoomPct());
    // LOD 立即重算（T2.12）：进 2D 顶视即降 far（细节件在顶视只会多建面、糊尺寸线），
    // 回 3D 按策略恢复——不等 300ms 检测节拍，免得切换瞬间出现一次可见的画面跳变
    this.lod.apply(this.lod.targetNow());
  }

  /** 视图预设（P2）：绕当前目标点重设机位（2D 下无预设机位，HUD 已隐藏入口） */
  setViewPreset(kind: ViewPreset): void {
    this.rig.setPreset(kind);
  }

  /** 缩放（状态栏 ±）：factor > 1 为拉近（2D = 正交 zoom 等比放大） */
  zoomBy(factor: number): void {
    this.rig.zoomBy(factor);
  }

  /** 回到初始机位（状态栏百分比 / HUD 重置视图；2D = 重新按内容自适应取景） */
  resetView(): void {
    if (this.rig.mode === '2d') {
      this.rig.applyFit2D(this.rig.fit2D(this.entries.values(), this.rooms));
      this.cb.onZoom(this.rig.zoomPct());
      return;
    }
    this.rig.reset3d();
  }

  /** 把目标点对准到世界坐标（HUD「定位到选中组件」；2D = 平移到该点，保持缩放） */
  focusOn(x: number, y: number, z: number): void {
    this.rig.focusOn(x, y, z);
  }

  // ---------- 拖放放置（T2.2 / FR-M02） ----------

  /** 屏幕坐标 → 地面（y=0）世界坐标（mm）：拖放落点 / 幽灵预览定位 */
  groundPointAt(clientX: number, clientY: number): { x: number; z: number } | null {
    return this.groundPoint(clientX, clientY);
  }

  /**
   * 拖放预览：从组件库拖拽卡片时，在落点（已吸附网格）显示半透明幽灵。
   * 幽灵按类型默认尺寸渲染（新实例即默认尺寸）；同类型只移动、换类型才重建几何。
   */
  setDragPreview(type: ComponentType, x: number, z: number): void {
    if (!this.dragGhost || this.dragGhost.typeId !== type.id) {
      this.clearDragPreview();
      const group = new THREE.Group();
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(VP_SELECTION),
        transparent: true,
        opacity: 0.45,
        roughness: 0.9,
        depthWrite: false,
      });
      // 幽灵按类型默认尺寸渲染（ratio = 1：两种 anchor 的偏移都等于 offset 本身）
      for (const prim of visiblePrims(type, this.lodMode)) {
        const mesh = new THREE.Mesh(this.assets.geometryOf(prim), material);
        const placed = placePrimitive(prim, { x: 1, y: 1, z: 1 });
        mesh.position.set(placed.position.x, placed.position.y, placed.position.z);
        group.add(mesh);
      }
      this.scene.add(group);
      this.dragGhost = { group, material, typeId: type.id };
    }
    this.dragGhost.group.position.set(x, 0, z);
  }

  /** 清除拖放预览幽灵（拖出视口 / 落点无效 / 拖拽结束）；几何来自缓存不在此释放（T2.10f） */
  clearDragPreview(): void {
    if (!this.dragGhost) return;
    this.scene.remove(this.dragGhost.group);
    this.dragGhost.group.clear();
    this.dragGhost.material.dispose();
    this.dragGhost = null;
  }

  /**
   * 选择集同步（T2.4 / FR-M07 / §10.3：选中 = 粉色描边）：
   * 每个选中组件一条 BoxHelper（增量增删，避免整组重建）；变换手柄仅单选时附着（T2.3）。
   */
  select(ids: string[], primaryId: string | null): void {
    this.selectedIds = [...ids];
    this.primaryId =
      primaryId && this.selectedIds.includes(primaryId)
        ? primaryId
        : this.selectedIds.length > 0
          ? this.selectedIds[this.selectedIds.length - 1]
          : null;

    // 选中件摘出实例桶、取消选中件挂回桶里（T2.10g）——必须先做，下面的 BoxHelper 才有 mesh 可框
    this.syncSoloStates();

    // 描边增量对账：新增缺失的、刷新位置、移除多余的
    const keep = new Set<string>();
    for (const id of this.selectedIds) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      keep.add(id);
      let box = this.selectionBoxes.get(id);
      if (!box) {
        box = new THREE.BoxHelper(entry.group, new THREE.Color(VP_SELECTION));
        this.scene.add(box);
        this.selectionBoxes.set(id, box);
      } else {
        box.update();
      }
    }
    for (const [id, box] of [...this.selectionBoxes]) {
      if (!keep.has(id)) {
        this.scene.remove(box);
        box.geometry.dispose();
        (box.material as THREE.Material).dispose();
        this.selectionBoxes.delete(id);
      }
    }

    // 变换手柄：多选时不显示（整体变换留待后续版本），单选时附着主选中
    if (this.selectedIds.length === 1 && this.primaryId) {
      const entry = this.entries.get(this.primaryId);
      if (entry) this.handles.attach(entry.comp);
      else this.handles.detach();
    } else {
      this.handles.detach();
    }
  }

  /**
   * 变换手柄拖拽实时预览（T2.3）：合并 fields 后直接更新场景 group 与描边。
   * 渲染层不反写 Document —— 提交在拖拽结束（onTransformCommit → TransformComponentCommand），
   * 随后 Document 'updated' → addOrUpdate 再同步一次，保证两端一致。
   */
  private applyTransformPreview(fields: Partial<TransformFields>): void {
    const entry = this.primaryId ? this.entries.get(this.primaryId) : undefined;
    if (!entry) return;
    const merged: Component = { ...entry.comp, ...fields };
    this.store.applyTransform(entry, merged);
    const box = this.selectionBoxes.get(entry.comp.id);
    if (box) box.update();
    this.handles.syncTo(merged);
  }

  /** 网格步长 + 吸附开关（FR-M04：网格密度 / 拖放 / 变换手柄 / 2D 直接拖拽共用同一吸附约定） */
  setGridStep(step: number, snap = true): void {
    // 场地尺寸量化到步长（P5 R1）：两层场地网格在 SiteGrid 内重画；
    // 房间自带网格与场地网格同格距，格距变了必须一起重画（P5）——与场地尺寸是否变化无关
    this.site.setStep(step, snap, this.rooms);
    this.rebuildRooms();
    this.handles.setSnap(snap, step);
  }

  // ---------- 性能基线（S2.0d / T3.6，/fps 页面） ----------

  /** 相机自动环绕：采样「相机运动」负载下的 fps（OrbitControls.autoRotate，speed=2 即 60fps 下 30s/圈） */
  setAutoRotate(on: boolean, speed = 2.0): void {
    this.rig.setAutoRotate(on, speed);
  }

  /** 相机取景：对准 (cx, cz) 中心、按区域跨度 extent 自适应距离（大阵列场景载入后自动框选；仅 3D） */
  frameArea(cx: number, cz: number, extent: number): void {
    this.rig.frameArea(cx, cz, extent);
  }

  /** 渲染器统计（draw calls / 三角形数；读取值为上一渲染帧的结果） */
  getRenderStats(): { calls: number; triangles: number } {
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }

  /** 网格显隐（§10.1 视口设置）：两层网格由 SiteGrid 持有 */
  setGridVisible(visible: boolean): void {
    this.site.setVisible(visible);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    this.fx.unbind();
    this.rig.unbindNavKeys();
    this.select([], null);
    this.clear();
    this.clearDragPreview();
    this.layer.dispose();
    // 批渲染层：桶与桶材质彻底回收（实例 buffer 归它自己，几何由 AssetRegistry 统一释放）
    this.store.dispose();
    // 共享几何到此刻才释放（T2.10f：实例删除只摘节点，几何由 AssetRegistry 统一回收）
    this.assets.dispose();
    // 场地环境层一次收口：网格 / 地面 / 描边 / 天空纹理 / 裁剪刷材质 / 阴影贴图
    this.site.dispose();
    this.handles.dispose();
    this.overlay.dispose();
    this.rig.dispose();
    this.renderer.dispose();
    el.parentElement?.removeChild(el);
  }



  // ---------- 房间构建（T2.8） ----------





  /** 全量重建房间图形（选中态切换 / 网格步长变化；房间数量少，重建代价可忽略） */
  private rebuildRooms(): void {
    this.layer.rebuild();
  }

  /**
   * 房间选中态（P5：房间可拾取）：选中房间 = 与组件同一支粉（地板浅染 + 轮廓实粉）。
   * 房间不参与多选与变换手柄，选择语义与组件互斥（应用层负责清组件选择集）。
   */
  selectRoom(id: string | null): void {
    this.layer.select(id);
  }

  /** 屏幕坐标 → 命中的房间 ID（只测地板面；组件优先命中，房间是兜底拾取） */
  private pickRoom(clientX: number, clientY: number): string | null {
    const targets = this.layer.floorTargets();
    if (targets.length === 0) return null;
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.activeCamera());
    for (const h of this.raycaster.intersectObjects(targets, false)) {
      const id = h.object.userData.roomId;
      if (typeof id === 'string') return id;
    }
    return null;
  }

  /** 3D 自动取景：框住全部房间占地（新建房间后调用；2D 有自己的自适应取景） */
  frameRooms(): boolean {
    return this.layer.frameRooms();
  }

  private ndc(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  /**
   * 拾取：命中组件 ID 列表（近 → 远，同组件多 mesh 去重，T2.4 穿透选择用；2D/3D 走活动相机）。
   * 粗筛 + 求交逻辑在纯函数 `pickComponentIds`（T2.10f，单测锁死，见 viewport.pick.test.ts）。
   */
  /**
   * 拾取：命中组件 ID 列表（近 → 远，同组件多 mesh 去重，T2.4 穿透选择用；2D/3D 走活动相机）。
   * 粗筛 + 求交逻辑在 `pickHits`（T2.10f 单测锁死）；批渲染开启时独立 mesh 与实例桶两路命中
   * 会按世界距离合并排序（T2.10h：穿透顺序在双路混排下必须与关批时完全一致）。
   */
  private pickAll(clientX: number, clientY: number): string[] {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.activeCamera());
    return pickHits(
      this.raycaster,
      this.entries.values(),
      this.batching === 'on' ? this.batch : null,
    ).ids;
  }

  private groundPoint(clientX: number, clientY: number): { x: number; z: number } | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.activeCamera());
    const pt = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, pt);
    return hit ? { x: pt.x, z: pt.z } : null;
  }

  /** 当前活动相机（T2.6：拾取 / 渲染 / 投影统一入口）——Phase 2 起归属 CameraRig */
  private activeCamera(): THREE.Camera {
    return this.rig.activeCamera();
  }





  /** WASD 平移开关（应用层在弹窗 / 菜单打开时关闭，避免按键误平移）——按键状态在 CameraRig */
  setNavKeysEnabled(enabled: boolean): void {
    this.rig.setNavKeysEnabled(enabled);
  }



  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.rig.layoutOrtho(); // 正交视锥宽高比跟随容器（3D 模式下仅保持一致，不参与渲染）
    this.renderer.setSize(w, h);
    this.overlay.resize(w, h);
  }



  /** 2D 标注数据（T2.6 / FR-V02）：主选中组件 W×D + 房间名称与尺寸（每帧由 animate 驱动覆盖层） */
  private collectAnnotation(): { comp: ComponentAnnotation | null; rooms: RoomAnnotation[] } {
    let comp: ComponentAnnotation | null = null;
    if (this.primaryId) {
      const entry = this.entries.get(this.primaryId);
      if (entry) {
        // 用场景 group 位置（渲染层事实源：直接拖拽预览期间领先 Document 提交）
        comp = {
          id: entry.comp.id,
          x: entry.group.position.x,
          z: entry.group.position.z,
          yawDeg: yawDegrees(entry.comp.rotation),
          w: entry.comp.size.w,
          d: entry.comp.size.d,
        };
      }
    }
    const rooms: RoomAnnotation[] = this.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      x: r.position.x,
      z: r.position.z,
      width: r.width,
      depth: r.depth,
    }));
    return { comp, rooms };
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.animate);
    const now = performance.now();
    // WASD 移动画布（交互范式改版 §10.3）：控制器 update 之前施加本帧位移；
    // dt 钳制 50ms（切 tab 回来不跳变）
    const dt = Math.min((now - this.lastFrameAt) / 1000, 0.05);
    this.lastFrameAt = now;
    this.rig.applyNavPan(dt);
    // 只更新活动控制器（避免非活动侧的阻尼惯性继续位移）
    if (this.mode === '2d') this.controls2d.update();
    else this.controls.update();
    // LOD 自动升降档（T2.12）：控制器 update 之后取距离，按节拍检测（内部自判是否真需要切）
    this.lod.tick(now);
    // 实例矩阵 / 逐实例色上传（T2.10g）：只处理本帧脏桶，无脏桶时直接跳过
    this.batch.flush();
    this.renderer.render(this.scene, this.activeCamera());
    // 2D 覆盖层：橡皮筋 + 尺寸标注（DOM 直写，不进 React，与罗盘同一约定）
    if (this.mode === '2d') {
      const ann = this.collectAnnotation();
      this.overlay.update(this.ortho, ann.comp, ann.rooms);
    }

    // fps 采样 + 缩放百分比（状态栏显示，§10.1）
    this.frames += 1;
    if (now - this.lastFpsAt >= 500) {
      const fps = Math.round((this.frames * 1000) / (now - this.lastFpsAt));
      this.cb.onFps(fps);
      this.frames = 0;
      this.lastFpsAt = now;
      this.cb.onZoom(this.rig.zoomPct());
      // 帧统计（T2.10g 验收口径要在界面上看得见）：与 fps 同一 500ms 节拍，不逐帧刷 React
      this.cb.onStats?.({
        fps,
        ...this.getRenderStats(),
        batching: this.batching,
        ...this.getBatchStats(),
      });
    }
    // P2：相机朝向 10Hz 发给 HUD 罗盘（每帧回调会拖慢低配机；2D 顶视朝向恒定，罗盘隐藏）
    if (this.mode === '3d' && this.cb.onCamera && this.rig.shouldEmitCamera(now)) {
      this.rig.emitCamera();
    }
  };
}
