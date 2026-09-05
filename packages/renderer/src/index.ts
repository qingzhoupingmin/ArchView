// ArchView 渲染层（three.js 场景增量同步 / 视口控制 / 拾取 / 2D 覆盖层，§8.1）
// ⚠️ 本文件是 @archview/renderer 对外的唯一门面：应用层一律从这里导入，
//    内部怎么拆（viewport/ 子模块等）都不该动这份导出名单。
export { Viewport3D } from './viewport';
// 双路拾取纯函数（Phase 1 拆出，node 环境可单测）
export { pickComponentIds, pickHits } from './viewport/picking';
// 视口事件协议与结构契约（Phase 1 拆出）
export type {
  ViewportCallbacks,
  ViewportStats,
  ViewPreset,
  ViewMode,
  ShadowMode,
  ContextHit,
  PickEntry,
  PickHit,
} from './viewport/types';
export type { ComponentAnnotation, RoomAnnotation } from './overlay2d';
export {
  TransformHandles,
  type HandleKind,
  type TransformHandlesCallbacks,
} from './transform-handles';
// 实例化批渲染（S2.5 / T2.10g）：BatchLayer 与开关类型供应用层与单测引用
export {
  BatchLayer,
  applyEmissiveVColorPatch,
  BATCH_EMISSIVE_VCOLOR,
  type BatchHit,
  type BatchPrim,
  type BatchingMode,
} from './instancing';
// 出图（T3.5 / FR-V07）：倍率决策纯函数，供单测与应用层共用
export { MAX_CAPTURE_EDGE, resolveCaptureScale } from './capture';
