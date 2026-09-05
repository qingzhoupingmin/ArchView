/**
 * 组件几何纯函数（S2.5 / T2.10b + T2.10g，产品文档 §6.2 / §8.2-11）：
 * 图元的「尺寸比例 → 局部放置」与「包围盒」计算收口在 core，渲染层（renderer）与
 * 素材闸门（component-lib schema 测试）共用同一份实现，避免两处语义漂移。
 * 单位一律 mm，右手系 Y 轴向上，组件原点在占地中心、地面 y=0（§6.4）。
 *
 * 本文件同时是批渲染（T2.10g）的**正确性来源**：`primLocalMatrix` / `instanceMatrixOf`
 * 与旧三层场景图的矩阵连乘逐元素等价（矩阵底座见 `matrix.ts`）。
 */
import type {
  Component,
  ComponentType,
  GeometryPrimitive,
  LodLevel,
  MaterialSlot,
  Size,
  Vec3,
} from './types';
import {
  IDENTITY_QUATERNION,
  mat4Compose,
  mat4Multiply,
  type Mat4,
} from './matrix';

/** 图元局部尺寸（box: [w,h,d] / cylinder: [r,h] / plane: [w,h] / sphere: [r] / cone: [r,h]）→ 三轴跨度 */
export function primDims(prim: GeometryPrimitive): Size {
  if (prim.kind === 'cylinder') {
    const [r, h] = prim.size;
    return { w: r * 2, d: r * 2, h: h ?? 0 };
  }
  if (prim.kind === 'plane') {
    // v3.9 起为朝 +Z 的竖向屏面（电视 / 大屏 / 指示牌 / 门禁 / 玻璃面板）：w=X、h=Y、深度 0
    const [w, h] = prim.size;
    return { w: w ?? 0, h: h ?? 0, d: 0 };
  }
  if (prim.kind === 'sphere') {
    const [r] = prim.size;
    return { w: r * 2, d: r * 2, h: r * 2 };
  }
  if (prim.kind === 'cone') {
    const [r, h] = prim.size;
    return { w: r * 2, d: r * 2, h: h ?? 0 };
  }
  const [w, h, d] = prim.size;
  return { w: w ?? 0, h: h ?? 0, d: d ?? 0 };
}

/**
 * 实例尺寸相对类型默认尺寸的缩放比例（FR-M03 非等比缩放）。
 * defaultSize 某轴为 0（如纯平面件的深度轴）时该轴回退 1，避免除零产生 Infinity 几何。
 */
export function sizeRatio(
  comp: Pick<Component, 'size'>,
  type: Pick<ComponentType, 'defaultSize'>,
): Vec3 {
  const d = type.defaultSize;
  return {
    x: d.w > 0 ? comp.size.w / d.w : 1,
    y: d.h > 0 ? comp.size.h / d.h : 1,
    z: d.d > 0 ? comp.size.d / d.d : 1,
  };
}

/**
 * 图元在组件局部空间内的放置（位置 + 自身缩放），anchor 决定偏移是否随尺寸缩放：
 * - `ground`（缺省）：`position = offset × ratio`、`scale = ratio`——与旧实现
 *   （整组 group.scale，偏移自然被缩放）**逐轴等价**，落地件与堆叠件表现零变化；
 * - `absolute`：`position = offset`（绝对安装高度，mm 不缩放）、`scale = ratio`——
 *   修「吊顶件改高度后飘出天花板」缺陷（开发计划 §4.2 T2.9 D-1）。
 */
export function placePrimitive(
  prim: GeometryPrimitive,
  ratio: Vec3,
): { position: Vec3; scale: Vec3 } {
  const scaled = (prim.anchor ?? 'ground') === 'ground';
  return {
    position: scaled
      ? {
          x: prim.offset.x * ratio.x,
          y: prim.offset.y * ratio.y,
          z: prim.offset.z * ratio.z,
        }
      : { ...prim.offset },
    scale: { ...ratio },
  };
}

/** 该图元当前档位是否应参与渲染：`far` = 常驻；`near` = 仅近景 / 漫游 / 出图模式 */
export function isPrimVisibleAt(prim: GeometryPrimitive, lod: LodLevel): boolean {
  const level = prim.lod ?? 'far';
  return level === 'far' || lod === 'near';
}

/** 按 LOD 档位取参与渲染的图元（`near` 档 = far + near 全量） */
export function visiblePrims(
  type: Pick<ComponentType, 'geometry'>,
  lod: LodLevel,
): GeometryPrimitive[] {
  return lod === 'near' ? [...type.geometry] : type.geometry.filter((p) => isPrimVisibleAt(p, 'far'));
}

/**
 * 组件类型在默认尺寸下的几何包围盒（闸门校验与占地核对用）。
 * 多部件组件取并集；`minY` 用于检测「穿地」（应 ≥ 0，允许 1mm 误差）。
 */
export function typeBounds(
  type: Pick<ComponentType, 'geometry'>,
): { w: number; h: number; d: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const prim of type.geometry) {
    const dims = primDims(prim);
    // 默认尺寸下 ratio = 1，两种 anchor 的偏移都等于 offset 本身
    minX = Math.min(minX, prim.offset.x - dims.w / 2);
    maxX = Math.max(maxX, prim.offset.x + dims.w / 2);
    minY = Math.min(minY, prim.offset.y - dims.h / 2);
    maxY = Math.max(maxY, prim.offset.y + dims.h / 2);
    minZ = Math.min(minZ, prim.offset.z - dims.d / 2);
    maxZ = Math.max(maxZ, prim.offset.z + dims.d / 2);
  }
  if (!Number.isFinite(minX)) return { w: 0, h: 0, d: 0, minY: 0, maxY: 0 };
  return {
    w: maxX - minX,
    h: maxY - minY,
    d: maxZ - minZ,
    minY,
    maxY,
  };
}

/**
 * 组件类型的「代表色」（主图元色）：属性面板显示与「恢复类型默认色」按钮用。
 * 渲染层自 S2.5 起按**逐图元** color 上材质，而面板只能编辑整组件一个显示色，
 * 故两边统一从这里取代表色，避免 web / renderer 各写一份 `geometry[0].color` 造成漂移。
 */
export function typeSwatchColor(type: Pick<ComponentType, 'geometry'>): string | undefined {
  return type.geometry[0]?.color;
}

/* ============ 实例色下的逐图元配色（T2.11 / 产品文档 §10.4） ============ */

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** `#RGB` / `#RRGGBB` → 0~1 三分量；非法输入返回 null（素材色写错时不炸渲染层） */
function parseHex(color: string): { r: number; g: number; b: number } | null {
  const hex = color.trim().replace(/^#/, '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** 感知亮度（Rec.601 加权和，0~1）；只要求单调，故不做 gamma 线性化 */
function luma(rgb: { r: number; g: number; b: number }): number {
  return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
}

/** RGB(0~1) → HSL(各 0~1) */
function rgbToHsl(rgb: { r: number; g: number; b: number }): { h: number; s: number; l: number } {
  const { r, g, b } = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (l > 0.5 ? 2 - max - min : max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

/** HSL(各 0~1) → `#RRGGBB`（大写，与素材数据风格一致） */
function hslToHex(h: number, s: number, l: number): string {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const chan = (t0: number): string => {
    // 色相分量必须先归一化到 [0,1)：h ± 1/3 会越界（如 h=0.94 时 h+1/3=1.28），
    // 漏掉这一步会让某一段直接落到 p（最暗值），色相被整体拽偏（实测偏 ≈100°）。
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    const x =
      t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return Math.round(clamp01(x) * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return (`#${chan(h + 1 / 3)}${chan(h)}${chan(h - 1 / 3)}`).toUpperCase();
}

/** 明度比的安全区间：再小会黑成一团、再大会把主色洗白 */
const TINT_RATIO_MIN = 0.5;
const TINT_RATIO_MAX = 1.5;

/**
 * 实例显示色存在时的**逐图元**配色（T2.11，产品文档 §10.4）。
 *
 * 要解决的问题：渲染层的取色优先级是「实例色 → 图元色 → 默认灰」（FR-D01），
 * 于是用户在属性面板改一次颜色，L1 / L2 素材精修的多部件色就**整体被一个颜色抹平**，
 * 精修价值只剩材质档的光泽差。但反过来把优先级倒过去也不对——整组件单色覆盖正是
 * 冷热通道着色（FR-V06）与孪生告警着色的地基。
 *
 * 折中：把实例色当**底色**，按「该图元原色相对类型代表色的明度比」压暗 / 提亮。
 * 结果仍是用户选的那一支色（着色语义不失效），但门 / 网孔 / 导轨 / LED 的深浅层次保住了。
 *
 * @param instanceColor 实例显示色（`comp.color`）
 * @param primColor     图元自色（`prim.color`）
 * @param swatchColor   类型代表色（= 主图元色，见 `typeSwatchColor`），明度比的基准
 * @returns 调制后的 `#RRGGBB`；`undefined` = 无需调制（交回调用方的缺省回退链）
 */
export function tintPrimColor(
  instanceColor: string | undefined,
  primColor: string | undefined,
  swatchColor: string | undefined,
): string | undefined {
  if (!instanceColor || !primColor) return undefined;
  // 代表色缺失（无主图元色）或与图元同色：没有可比基准，直接整体覆盖 = 旧表现
  if (!swatchColor || primColor === swatchColor) return instanceColor;
  const base = parseHex(instanceColor);
  const prim = parseHex(primColor);
  const swatch = parseHex(swatchColor);
  if (!base || !prim || !swatch) return instanceColor;
  const l0 = luma(swatch);
  if (l0 < 0.02) return instanceColor; // 代表色近黑，明度比会爆炸，退回整体覆盖
  const ratio = clamp(luma(prim) / l0, TINT_RATIO_MIN, TINT_RATIO_MAX);
  const { h, s, l } = rgbToHsl(base);
  // 提亮轻微去饱和（防高光死白）、压暗轻微加饱和（保住色相仍读得出是哪支色）
  const sat = clamp01(s * (ratio >= 1 ? 1 - (ratio - 1) * 0.4 : 1 + (1 - ratio) * 0.35));
  return hslToHex(h, sat, clamp(l * ratio, 0.06, 0.9));
}

/** 该类型用到的材质档集合（闸门校验 / 卡片角标用） */
export function typeMaterialSlots(type: Pick<ComponentType, 'geometry'>): MaterialSlot[] {
  const slots = new Set<MaterialSlot>();
  for (const prim of type.geometry) slots.add(prim.material ?? 'matte');
  return [...slots];
}

/** 按 LOD 档位统计参与渲染的图元数（`far` 档计数即产品文档 §7 图元预算的断言口径） */
export function primBudgetCount(type: Pick<ComponentType, 'geometry'>, lod: LodLevel = 'far'): number {
  return visiblePrims(type, lod).length;
}

/**
 * 单图元三角面数（素材 L3 专项的面数预算口径，产品文档 §6.5.1）。
 *
 * 数值必须与 renderer `AssetRegistry.geometryOf` 的分段参数**逐一对应**：
 * Cylinder/Cone 径向 24 段、Sphere 24×16 段。漂移由 renderer 侧
 * `assets.test.ts` 用真实 BufferGeometry 的 index 数反向锁死。
 * 实例化（T2.10g）后图元数不再 1:1 对应 draw call，面数才是显存与顶点吞吐的真账。
 */
export function primTriangleCount(prim: GeometryPrimitive): number {
  switch (prim.kind) {
    case 'cylinder': // 侧面 24×2 + 上下底各 24
      return 96;
    case 'cone': // 侧面 24 + 底 24
      return 48;
    case 'sphere': // 24 列 × (16−2) 行四边 + 顶/极点各 24
      return 24 * 14 * 2 + 24 * 2;
    case 'plane':
      return 2;
    case 'box':
      return 12;
  }
}

/** 单类型按 LOD 档位的三角面总数（闸门预算断言口径，与 `primBudgetCount` 同档位语义） */
export function primTriangleBudget(
  type: Pick<ComponentType, 'geometry'>,
  lod: LodLevel = 'far',
): number {
  return visiblePrims(type, lod).reduce((n, p) => n + primTriangleCount(p), 0);
}

/* ============ 图元 / 实例的世界矩阵（T2.10g 批渲染，产品文档 §8.2-11 ③） ============ */

/**
 * 图元在**组件局部空间**里的矩阵（`T(偏移) × R(姿态) × S(尺寸比)`）。
 *
 * 它就是旧三层结构里 `mesh.matrix` 的那一份：`placePrimitive` 决定偏移按 `anchor` 缩放还是不缩放，
 * 尺寸比写在自身缩放里。`plane` 是朝 +Z 的竖向屏面（v3.9 语义修正，零旋转）。
 * 渲染层把它挂在 holder 上、批渲染把它当实例矩阵的右半段，
 * 两条路径共用同一算式 ⇒ 「合批前 / 合批后画面逐像素一致」才有保障。
 */
export function primLocalMatrix(prim: GeometryPrimitive, ratio: Vec3): Mat4 {
  const placed = placePrimitive(prim, ratio);
  return mat4Compose(placed.position, IDENTITY_QUATERNION, placed.scale);
}

/**
 * 实例的三轴尺寸比：`size / defaultSize`（FR-M03 非等比缩放）再乘 `comp.scale`。
 * 与渲染层旧 `ratioOf`（`sizeRatio` × `comp.scale`）同一口径，抽出来给批渲染复用。
 */
export function instanceScaleRatio(
  comp: Pick<Component, 'size' | 'scale'>,
  type: Pick<ComponentType, 'defaultSize'>,
): Vec3 {
  const r = sizeRatio(comp, type);
  return { x: r.x * comp.scale.x, y: r.y * comp.scale.y, z: r.z * comp.scale.z };
}

/**
 * 图元在**世界空间**的矩阵 = `位姿(实例) × 图元局部矩阵`。
 *
 * 严格等价于旧场景图 `group(position, quaternion) > holder(恒等) > mesh(局部矩阵)` 连乘的结果，
 * 是 T2.10g「把 N 个 mesh 压成 1 个 InstancedMesh 桶」的正确性基石（等价性由 renderer 侧单测锁死）。
 * 注意：`comp.position` 必须是**渲染层当前真值**——直接拖拽预览期间 group 位置领先 Document 提交，
 * 调用方（`Viewport3D`）负责用 group 位姿而非 Document 值传入。
 */
export function instanceMatrixOf(
  comp: Pick<Component, 'position' | 'rotation'>,
  prim: GeometryPrimitive,
  ratio: Vec3,
): Mat4 {
  const pose = mat4Compose(comp.position, comp.rotation, { x: 1, y: 1, z: 1 });
  return mat4Multiply(pose, primLocalMatrix(prim, ratio));
}

/** 图元的局部 AABB 三轴半长（`plane` 的 d = 0 ⇒ 该轴退化为面片，与 `primDims` 同口径） */
export function primHalfExtents(prim: GeometryPrimitive): Vec3 {
  const d = primDims(prim);
  return { x: d.w / 2, y: d.h / 2, z: d.d / 2 };
}
