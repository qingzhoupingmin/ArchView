/**
 * 视口类型契约（架构拆分 Phase 1，自 `viewport.ts` 逐字迁出）
 *
 * 本文件只放**类型**，不放任何运行时逻辑（除 `pickHits` 等去处另有归宿）：
 * 它是渲染层与的应用层之间唯一的「事件协议」来源，改这里 = 改对外契约，务必谨慎。
 */
import type * as THREE from 'three';
import type {
  Component,
  ComponentType,
  GeometryPrimitive,
  LodLevel,
  Quaternion,
  TransformFields,
  Vec3,
} from '@archview/core';
import type { BatchHit, BatchPrim, BatchingMode } from '../instancing';

/** 视口交互回调（渲染层只发事件、不反写 Document，§8.2） */
export interface ViewportCallbacks {
  /**
   * 选择变更（T2.4 / FR-M07）：选择集 + 主选中（最后点击的，null = 未选中）。
   * 空数组 = 取消选择。Ctrl+单击多选切换 / 同位连点穿透由渲染层判定后上报最终集合。
   */
  onSelectChange(ids: string[], primaryId: string | null): void;
  /** 双击组件（T2.4 / §10.3「双击组件聚焦」）；双击空处为 null */
  onDoubleClick?(id: string | null): void;
  /** 光标在地面（y=0）上的坐标（mm） */
  onCursorMove(pos: { x: number; z: number } | null): void;
  onFps(fps: number): void;
  /** 相对初始距离的缩放百分比 */
  onZoom(pct: number): void;
  /** P2 HUD：相机方位角 / 极角（度），10Hz 节流回调，罗盘不每帧刷 React */
  onCamera?(azimuthDeg: number, polarDeg: number): void;
  /** 变换手柄拖拽中（T2.3/FR-M06）：渲染层已应用预览，应用层可同步状态栏（吸附后数值） */
  onTransformLive?(id: string, fields: Partial<TransformFields>): void;
  /** 变换手柄拖拽结束（T2.3/FR-M06）：应用层执行 TransformComponentCommand（单条撤销记录，FR-M08） */
  onTransformCommit?(id: string, fields: Partial<TransformFields>): void;
  /** 2D 直接拖拽批量提交（T2.6 / FR-V02）：整个选择集一起移动 = 单条 TransformComponentCommand = 单条撤销记录（FR-M08） */
  onTransformBatchCommit?(items: { id: string; after: Partial<TransformFields> }[]): void;
  /**
   * 右键详情菜单（T2.6 / §10.3，交互范式改版后 2D/3D 共用）：容器相对像素坐标 + 命中目标，
   * 应用层渲染菜单（组件 / 房间详情 + 动作；空处 = 重置机位 / 定位选中）
   */
  onContextMenu?(x: number, y: number, hit: ContextHit): void;
  /** 房间拾取（P5）：点中房间地板上报其 ID，点空处上报 null（与组件选择集互斥） */
  onRoomClick?(roomId: string | null): void;
  /**
   * LOD 档位实际变化（T2.12）：仅在 `far` ↔ `near` 真的切换（即完成一次图形重建）时触发，
   * 应用层据此刷新状态栏 chip；相机连续推拉时天然低频（迟滞带保证）。
   */
  onLod?(mode: LodLevel): void;
  /**
   * 批渲染开关实际变化（T2.10g / §B-2 双路并存）：应用层据此刷新状态栏「合批」chip。
   * 只在 `setBatching` 真的换档（= 完成一次全场景重建）时触发。
   */
  onBatching?(mode: BatchingMode): void;
  /**
   * 阴影模式实际变化（T2.10a 性能模式）：应用层据此刷新状态栏「阴影」chip。
   */
  onShadowMode?(mode: ShadowMode): void;
  /**
   * 帧统计（与 `onFps` 同一 500ms 节拍）：绘制调用 / 三角形数 + 批渲染读数。
   * 状态栏与 `/fps` 基线页据此显示「绘制调用」——T2.10g 的验收口径（1000 组件 ≤ 64）
   * 必须让主人在界面上直接看见，不能只在控制台里。
   */
  onStats?(stats: ViewportStats): void;
}

/** 阴影模式（T2.10a 性能模式最小版）：`off` = 关掉整条阴影通道（约占一半 draw call） */
export type ShadowMode = 'on' | 'off';

/** 帧统计读数（`onStats` 载荷） */
export interface ViewportStats {
  fps: number;
  /** 上一渲染帧的 draw calls（阴影通道开着时含两次绘制） */
  calls: number;
  triangles: number;
  /** 批渲染开关（T2.10g） */
  batching: BatchingMode;
  /** 实例桶数：合批后的 draw call 上限（单通道），桶数少 = 合批有效 */
  buckets: number;
  /** 进了桶的图元实例数（不含被摘成独立 mesh 的选中件） */
  instances: number;
}

/** 视图模式（T2.6 / FR-V02 / V03）：同场景双相机，选择 / 变换 / 属性两视图共享 */
export type ViewMode = '2d' | '3d';

/** 右键命中目标（交互范式改版 §10.3 详情菜单）：组件优先、房间地板兜底，空处 = 双 null */
export interface ContextHit {
  componentId: string | null;
  roomId: string | null;
}

/** 视图预设（P2 HUD 视图工具条） */
export type ViewPreset = 'iso' | 'top' | 'front' | 'side';

/**
 * 组件显示条目（渲染层的场景对象内核，T2.10e 层级 + T2.10g 双路）：
 * `EntryStore` 是它唯一的持有者与写入者，其他协作者一律只读。
 */
export interface Entry {
  group: THREE.Group;
  /** 图元容器：与 group 同位姿但**不参与尺寸缩放**（anchor 语义的实现载体，T2.10e） */
  holder: THREE.Group;
  /** 图元 mesh，顺序与 visiblePrims(type, lod) 严格一一对应；**仅 `solo = true` 时非空** */
  meshes: THREE.Mesh[];
  /** 本组件的材质桶（键 = 档位|颜色，T2.10d）；随实例色 / 类型变化重建并释放旧的，仅 solo 路径持有 */
  materials: Map<string, THREE.MeshStandardMaterial>;
  /**
   * 走独立 mesh（`true`）还是进实例桶（`false`）——T2.10g / §B-2 双路并存的开关落点：
   * 关批时全为 true；开批时**选中件仍为 true**（描边 / 变换手柄 / 逐实例色都在 mesh 上做，
   * 不在 shader 里做选中态），其余组件为 false。
   */
  solo: boolean;
  /** 当前参与渲染的图元（`visiblePrims(type, lodMode)` 的快照，随类型 / 档位变化重建） */
  primCache: GeometryPrimitive[];
  /** `primCache` 是哪个类型对象建的（身份比较，素材刷新会给出同 ID 的新类型对象） */
  primSource: ComponentType | null;
  /** `primCache` 是哪个档位建的（far / near 切换即结构变化） */
  primLod: LodLevel;
  /**
   * 批渲染的图元数据（仅 `solo = false` 时有效）：**对象复用、矩阵就地重写**，
   * 逐帧拖拽不产生新数组；顺序与 `primCache` 一一对应。
   */
  batchPrims: BatchPrim[];
  /** 组件实例（Document 内的活引用，addOrUpdate 传入即最新）：变换手柄 / 预览用（T2.3） */
  comp: Component;
  /** 组件类型（applyTransform 需要 defaultSize） */
  type: ComponentType;
  /**
   * 位姿视图（T2.10g）：**引用 group 的 position / quaternion 本体**，交给 core
   * `instanceMatrixOf` 算实例矩阵。group 是渲染层的位姿事实源（直接拖拽期间比 Document 领先一帧），
   * 而它的 `rotation` 是 Euler、`quaternion` 才是四元数——这里显式取后者，且只建一次不逐帧分配。
   */
  pose: { position: Vec3; rotation: Quaternion };
  /**
   * 世界包围盒缓存（拾取粗筛，T2.10f）：变换后置脏、拾取时懒算。
   * 批渲染下 group 是空容器，`setFromObject` 会得到空盒，故 `refreshEntryVisuals`
   * 直接按图元算好并置 `boxDirty = false`（拾取路径只读不算）。
   */
  box: THREE.Box3;
  boxDirty: boolean;
  /** 上次建材质时的实例色快照（T2.10d）：只有颜色 / 类型变化才重建材质桶，改位置尺寸不重建 */
  colorKey: string;
}

/**
 * 房间显示条目（T2.8 / P5）：裁剪刷 + 地板 + 自带网格 + 线框轮廓；
 * key 为尺寸 / 位置 / 楼层指纹，变化时整体重建。
 */
export interface RoomEntry {
  group: THREE.Group;
  key: string;
}

/**
 * 拾取条目（T2.10f 粗筛 + 精确求交所需最小字段集，结构子集——`Entry` 直接满足）。
 * T2.10g 起多两个可选字段用于双路：缺省（旧调用方 / 单测）一律按 solo 处理，零回归。
 */
export interface PickEntry {
  group: THREE.Group;
  /** 图元 mesh（拾取命中目标，buildEntry 中已写 `userData.componentId`）；批渲染条目为空数组 */
  meshes: THREE.Mesh[];
  /** 世界包围盒缓存（拾取粗筛）：变换后置脏、拾取时懒算 */
  box: THREE.Box3;
  boxDirty: boolean;
  /** 组件 ID：批渲染分支命中后要能回溯到组件（solo 分支仍从 mesh.userData 取） */
  id?: string;
  /** `false` = 该组件已在实例桶里（group 无 mesh），精确求交交给 `BatchLayer.pick` */
  solo?: boolean;
}

/** 一次拾取命中（`id` + 世界距离）；solo 与批渲染两条路径共用同一形状以便合并排序 */
export type PickHit = BatchHit;

/** 2D 自适应取景结果（`CameraRig.fit2D` 返回） */
export interface Fit2D {
  cx: number;
  cz: number;
  viewSize: number;
}
