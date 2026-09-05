/**
 * ArchView 领域模型（产品文档 §6.2）。
 * 单位约定（§6.4）：长度 mm、角度 deg；右手系 Y 轴向上；机房原点 (0,0,0)。
 */

export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 四元数（UI 层可换算为角度，FR-M06） */
export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Size {
  w: number;
  d: number;
  h: number;
}

export interface GridConfig {
  /** 网格模数（mm），默认 600（架空地板砖边长） */
  step: number;
  /** 吸附开关（FR-M04） */
  snap: boolean;
}

/** 组件分类（§6.5：空间 / IT / 电力 / 制冷 / 线缆 / 其他 + T2.9 新增 6 个一级分类） */
export type Category =
  | 'space'
  | 'it'
  | 'power'
  | 'cooling'
  | 'cable'
  | 'other'
  | 'ac'
  | 'furniture'
  | 'fire'
  | 'electrical'
  | 'rack'
  | 'smart';

/**
 * 组件几何图元种类（v1 图元组合，§8.2-3；v2 升级 glTF）。
 * `sphere` / `cone` 自素材 L3 专项（开发计划 v3.8）加入：补「圆」的词汇
 * （镜头 / 球罩 / 喷头 / 阀件），`SCHEMA_VERSION` 维持 1（纯加法式，旧素材零改动）。
 */
export type PrimitiveKind = 'box' | 'cylinder' | 'plane' | 'sphere' | 'cone';

/**
 * 材质档（产品文档 §10.4 六档预设，S2.5 / T2.10b）。
 * 只有光学参数差异，**不涉及贴图库与 PBR 工作流**（§3.3 非目标不变）。
 * 具体数值见 @archview/theme 的 MAT_PRESETS（渲染层禁硬编码）。
 */
export type MaterialSlot = 'matte' | 'metal' | 'glass' | 'grille' | 'emissive' | 'rubber';

/**
 * 图元偏移的缩放语义（S2.5 / T2.10b，修「改尺寸导致安装高度漂移」缺陷）：
 * - `ground`（缺省）：偏移随实例尺寸等比缩放——落地件与结构堆叠件（底座 / 台板 / 阀头）用，
 *   保持与旧实现完全一致的表现（旧实现是整个 group 被 scale，偏移自然被缩放）；
 * - `absolute`：偏移为**绝对安装高度 / 位置**（mm），不参与尺寸缩放——吊顶、壁挂、吊装件用。
 */
export type PrimitiveAnchor = 'ground' | 'absolute';

/** 图元精细度档位（§6.5.1）：`far` 常驻渲染，`near` 仅近景 / 漫游 / 出图模式启用 */
export type LodLevel = 'far' | 'near';

export interface GeometryPrimitive {
  kind: PrimitiveKind;
  /** box: [w, h, d]；cylinder: [radius, height]；plane: [w, d]；sphere: [radius]；cone: [radius, height]（mm） */
  size: number[];
  /** 图元中心相对组件原点的局部偏移（mm）；原点在组件占地中心、地面 y=0；缩放语义见 anchor */
  offset: Vec3;
  /** 局部材质色（可选；缺省时回退实例 color / 主题默认色）。S2.5 起渲染层逐图元生效 */
  color?: string;
  /**
   * 子部件语义名（L2 标志，同组件内唯一）：body / door / vent / rail / led / panel / handle / foot…
   * U 位挂装（FR-D03）、剖切（FR-V04）、通道着色（FR-V06）与孪生告警（FR-T01~T03）的寻址依据。
   */
  name?: string;
  /** 材质档，缺省 `matte`（= 旧表现，旧素材零改动） */
  material?: MaterialSlot;
  /** 偏移缩放语义，缺省 `ground`（= 与旧实现一致）；吊顶 / 壁挂件应显式标 `absolute` */
  anchor?: PrimitiveAnchor;
  /** 精细度档位，缺省 `far`（常驻） */
  lod?: LodLevel;
  /** 是否投射阴影，缺省 true；小体积件与吊顶 / 壁挂件标 false（阴影通道约占一半 draw call） */
  castShadow?: boolean;
}

/** 组件类型定义（类型共享几何与默认值，实例只存实例数据，§6.1） */
export interface ComponentType {
  id: string;
  name: string;
  category: Category;
  defaultSize: Size;
  geometry: GeometryPrimitive[];
  /** 默认属性：功率（W）/ 制冷量（kW）/ U 位数等；布尔值 = 开关型参数（T2.9 单/双排） */
  defaultAttrs: Record<string, number | string | boolean>;
  /** U 位数（机柜类：42 / 47） */
  uSlots?: number;
  /**
   * emoji 后备标识（P0 遗留）。
   * P3 起 UI 层不再读取它——组件卡片图标改由 @archview/ui 的 ComponentGlyph 按
   * typeId / category 解析为描边 SVG（可跟随主题色、跨平台一致、不再有空心框）。
   * 字段保留是给导出报表等场景留一个纯文本标识，删除属破坏性变更。
   */
  icon?: string;
}

/** U 位挂装（机柜类，FR-D03，P2 启用） */
export interface UAssignment {
  u: number;
  componentId: string;
}

/** 组件实例（世界坐标 mm） */
export interface Component {
  id: string;
  typeId: string;
  /** 实例名（重名自动编号，FR-M09） */
  name: string;
  position: Vec3;
  rotation: Quaternion;
  scale: Vec3;
  /** 实例实际尺寸（FR-M03 精确尺寸输入；默认 = 类型 defaultSize） */
  size: Size;
  roomId?: string;
  /**
   * 所属设备排（T3.1，产品文档 §8.2-12）。「机柜 → 排 → 机房」三级统计的中间层归属。
   * 与 roomId? 同为可选：加法式变更，旧工程零迁移（缺字段由 migrateProject 补齐语义）。
   */
  rowId?: string;
  floorIndex?: number;
  /** 电力（W）/ 制冷（kW）等业务属性（布尔值 = 开关型参数，T2.9） */
  attrs: Record<string, number | string | boolean>;
  uAssignments: UAssignment[];
  tags: string[];
  note: string;
  visible: boolean;
  color?: string;
}

export type ZoneType = 'host' | 'power' | 'battery' | 'ac' | 'monitor' | 'aisle' | 'other';

export interface Zone {
  id: string;
  roomId: string;
  name: string;
  type: ZoneType;
  /** 二维轮廓（X-Z 平面，mm；用于面积统计与 2D 着色） */
  polygon: Vec2[];
}

/** 机房 / 楼层（§6.2） */
export interface Room {
  id: string;
  name: string;
  width: number;
  depth: number;
  height: number;
  /** 楼层序号（1 起，FR-M10，P1） */
  floorIndex: number;
  position: Vec2;
}

export type Visibility = 'private' | 'shared';

/**
 * 设备排（T3.1，FR-A01「机房 / 排 / 机柜」三级统计的中间层）。
 *
 * 为什么是一等实体而不是 tags 字符串：统计要按排聚合、T5.1 的 U 位与 PDU 归属要挂在排上、
 * T5.6 的冷热通道着色也要按排出图——挂在 `tags: ['A 排']` 上意味着「改个标签就换排、
 * 重名与拼写全无约束」，语义撑不住（产品文档 §8.2-12）。
 *
 * 字段刻意只保留三个：`axis`（排列轴向）与 `aisle`（冷/热通道）等此刻**零消费者**，
 * 等 T5.1 / T5.6 真要用了再加，避免重蹈「图元 color 声明形同虚设」的空气字段覆辙。
 */
export interface RackRow {
  id: string;
  /** 所属房间（与 Component.roomId 同口径；可空 = 尚未归入任何房间） */
  roomId?: string;
  /** 排名（如「A 排」；重名自动编号，规则与组件 / 房间一致） */
  name: string;
}

export interface ProjectMeta {
  createdAt: string;
  updatedAt: string;
}

/** 工程（数据根节点；FR-I01 .archview JSON 工程文件） */
export interface Project {
  id: string;
  name: string;
  /** 数据格式版本号（旧版本自动迁移策略，FR-I01） */
  schemaVersion: number;
  unit: 'mm';
  grid: GridConfig;
  rooms: Room[];
  /**
   * 设备排（T3.1，FR-A01 三级统计的中间层）。
   * 声明为必填以让 typecheck 揪出所有构造点，但**不升 schemaVersion**：
   * 旧工程缺此字段属加法式变更，由 `migrateProject` 在载入边界统一补 `[]`（产品文档 §8.2-12）。
   */
  rows: RackRow[];
  /** 功能区（§6.3 Room 1-n Zone；P0 存于工程级） */
  zones: Zone[];
  types: ComponentType[];
  components: Component[];
  /** 属主用户 ID（登录体系，FR-U08） */
  ownerId?: string;
  visibility: Visibility;
  meta: ProjectMeta;
}

/** 当前数据格式版本号 */
export const SCHEMA_VERSION = 1;
