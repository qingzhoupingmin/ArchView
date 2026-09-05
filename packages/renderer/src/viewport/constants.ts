/**
 * 视口常量（架构拆分 Phase 1，自 `viewport.ts` 逐字迁出）
 *
 * 这里集中了「场地 / 相机 / 机位 / LOD 节拍」四类硬参数——它们的取值几乎每一条都对应
 * 一次踩坑记录，注释即文档，改动前请先读完注释再动手。
 */

/**
 * 场地尺寸（mm）：地面与网格共用同一边界。
 * P3 起地面不再是「无限大平面」——原实现地面 400000mm 且与天空盒底部同为纯白，
 * 视口里看不到任何边界与地平线，用户失去空间参照（截图反馈「看着空、不像 3D」）。
 * 收到与网格同尺寸并描边，才是一块读得出来的「地板」。
 * P5：它同时是「最小场地」——房间占地超出时按 computeSiteSize 向外生长，不再出现
 * 「房间地板铺到场地之外、外圈无网格无阴影承接」的双层地板（开发计划 §4.2 已知问题 2）。
 */
export const GROUND_SIZE = 36000;
/** 主网格 = 次网格 × 该倍数（600mm 模数 → 每 3000mm 一条主线，提供尺度感） */
export const GRID_MAJOR_EVERY = 5;
/** 场地随房间生长的边距（mm）：房间外墙到场地边缘至少留 3m——30×20 标准机房仍落在基准 36000 内，默认工程零视觉变化 */
export const SITE_MARGIN = 3000;
/** 场地网格线数上限：超大场地按步长整数倍放大格距，避免线段数爆掉（帧率优先） */
export const GRID_LINE_BUDGET = 1200;

/** 2D 正交相机高度（mm，T2.6）：场景最大高度 ~3600（吊顶 3540+），40000 留足近裁剪余量 */
export const ORTHO_HEIGHT = 40000;
export const ORTHO_FAR = 120000;
/** 2D 可视世界高度（mm）钳制：最小可放大到单格细节，最大不超出场地太多 */
export const VIEW_SIZE_MIN = 3000;
export const VIEW_SIZE_MAX = 120000;
/** 2D 空场景默认取景（与 3D 初始目标点一致） */
export const VIEW2D_HOME = { x: 6000, z: 6000, viewSize: 24000 };
/**
 * 等轴机位（mm）：目标点 + 偏移量——构造器初始机位 / resetView / iso 预设（§10.3 快捷键 4）同源（T2.7），
 * 保证「初始机位 = 重置机位 = 等轴预设」，应用 iso 预设后状态栏缩放保持 100%（偏移模长 = baseDistance）。
 */
export const HOME_TARGET: [number, number, number] = [6000, 0, 6000];
export const HOME_OFFSET: [number, number, number] = [4000, 8000, 7000];
/**
 * 3D 俯仰下限（度）：极角 phi 是相机相对 target 的球坐标天顶角，90° = 水平线。
 * OrbitControls 默认 maxPolarAngle = Math.PI，中键拖拽能把相机一路绕到 target 正下方
 * （phi > 90°），而 HOME_TARGET 的 Y = 0 就是地面 —— 于是相机钻到地板底下看见网格背面。
 * 取 88° 而非 90°：留 2° 余量，避免相机与地面严格共面时又闹 z-fighting（v0.11 Y 层重排踩过同款坑）。
 * 必须与 controls.screenSpacePanning = false 配套：OrbitControls 的 pan 是相机与 target
 * 同向量位移，极角恒定不变，单靠 maxPolarAngle 拦不住「拖平移把相机 Y 拖到地下」。
 */
export const MAX_POLAR_DEG = 88;
/**
 * LOD 自动升降档的检测节拍（ms，T2.12）。
 * 切档 = 全量重建组件图形，逐帧判定会把「相机推拉」变成「逐帧重建」；
 * 300ms 既够不上手感延迟（升档是静景细节，不是拖拽反馈），又足够便宜。
 */
export const LOD_CHECK_INTERVAL_MS = 300;
/** 直接拖拽的「点击 / 拖拽」判定阈值（px²，§10.3）：位移平方 ≤25（即 5px）视为点击 */
export const CLICK_SLOP_SQ = 25;
/** 穿透连点的时间窗口（ms，T2.4 / FR-M07）：同位 1s 内重复点击才逐层深入 */
export const CLICK_THROUGH_WINDOW_MS = 1000;
