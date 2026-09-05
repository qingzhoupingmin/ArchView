/**
 * 粉白主题 TS 镜像常量（与 tokens.css 同源；渲染层视口颜色统一从这里取，禁硬编码，
 * 产品文档 §10.2 / 开发计划 §6）。命名：UPPER_SNAKE_CASE。
 */

/* 基础色 */
export const COLOR_BG = '#FDFBFC';
export const COLOR_SURFACE = '#FFFFFF';
export const COLOR_SURFACE_ALT = '#FAF7F9';

/* 主色（粉） */
export const COLOR_PRIMARY = '#EC6D9A';
export const COLOR_PRIMARY_HOVER = '#E15C8B';
export const COLOR_PRIMARY_SOFT = '#FCE4EC';
export const COLOR_PRIMARY_DEEP = '#C94672';
export const COLOR_PRIMARY_DEEP_HOVER = '#B53A5F';

/* 文本 */
export const COLOR_TEXT = '#4A4458';
/** P2 a11y：白底 12px 小字 5.3:1（AA）；旧值 #9B93A7 仅 3.0:1。
 *  注意：本文件必须与 tokens.css 逐值一致，由 tokens.test.ts 把关。 */
export const COLOR_TEXT_MUTED = '#6F6879';
/** 反色文本（深底 / 主按钮上） */
export const COLOR_TEXT_INVERSE = '#FFFFFF';

/* 线条与阴影 */
export const COLOR_BORDER = '#F0E9EF';
/** 强描边：网格线、地板边界等需要比 --color-border 更可见的地方 */
export const COLOR_BORDER_STRONG = '#E4DBE2';

/* 状态色 */
export const COLOR_SUCCESS = '#7BC47F';
export const COLOR_WARNING = '#F2B84B';
export const COLOR_ERROR = '#E8756A';

/* 视口（渲染层专用，产品文档 §10.4；值须与 tokens.css 的 --vp-* 完全一致）
   P3：拉开天空 / 地面 / 网格的明度层次，并新增主网格线与地面描边，恢复空间参照。 */
export const VP_SKY_TOP = '#F2E6EE';
export const VP_SKY_BOTTOM = '#FBF7FA';
export const VP_GROUND = '#E8DEE6';
export const VP_GRID = '#D2C3D1';
/** 每 5 格一条的主网格线（尺度参照） */
export const VP_GRID_MAJOR = '#B7A4B8';
/** 地面边界描边（让「地板」有形状，替代原先与背景同色的无限地面） */
export const VP_HORIZON = '#A99AB0';
export const VP_SELECTION = '#F06292';
export const VP_COMPONENT_DEFAULT = '#D8D5DE';

/* ============ 材质档光学参数（产品文档 §10.4 六档预设，S2.5 / T2.10c） ============
   只有 roughness / metalness / opacity / 自发光强度的差异，**不含任何贴图与 PBR 工作流**
   （§3.3 非目标不变）。数值参数不是颜色，故不进 HEX_TOKENS、不参与 CSS 同值校验；
   由 tokens.test.ts 锁「六档齐全 + 参数在合法区间 + 默认档等于历史表现」三条契约。 */

/** 材质档键（与 core 的 MaterialSlot 同名同集合，由 renderer 编译期对齐） */
export type MatSlot = 'matte' | 'metal' | 'glass' | 'grille' | 'emissive' | 'rubber';

export interface MatParams {
  /** 粗糙度 0~1 */
  roughness: number;
  /** 金属度 0~1 */
  metalness: number;
  /** 不透明度 0~1；< 1 时渲染层启用 transparent + 关 depthWrite */
  opacity: number;
  /** 自发光强度 0~1（0 = 关闭；仅 emissive 档使用，颜色取图元色） */
  emissive: number;
}

/** 六档材质预设：`matte` 刻意等于旧实现（roughness 0.85 / metalness 0.05），保证旧素材零回归 */
export const MAT_PRESETS: Record<MatSlot, MatParams> = {
  matte: { roughness: 0.85, metalness: 0.05, opacity: 1, emissive: 0 },
  metal: { roughness: 0.45, metalness: 0.55, opacity: 1, emissive: 0 },
  glass: { roughness: 0.15, metalness: 0.0, opacity: 0.28, emissive: 0 },
  grille: { roughness: 0.7, metalness: 0.3, opacity: 0.85, emissive: 0 },
  emissive: { roughness: 0.3, metalness: 0.0, opacity: 1, emissive: 0.6 },
  rubber: { roughness: 0.95, metalness: 0.0, opacity: 1, emissive: 0 },
};

/** 材质档枚举（供校验与 UI 下拉遍历） */
export const MAT_SLOTS = Object.keys(MAT_PRESETS) as MatSlot[];

/* 布局（产品文档 §10.1） */
export const TOPBAR_HEIGHT = 48;
export const STATUSBAR_HEIGHT = 28;
export const PANEL_WIDTH = 280;
export const RADIUS_MD = 8;

/**
 * 同源校验登记表：列出本文件所有十六进制色常量。
 * tokens.test.ts 会（1）扫描源码断言此表无漏登记，（2）逐值比对 tokens.css 的 :root 变量。
 * 新增色常量时必须同时加进这里，否则单测报错。
 */
export const HEX_TOKENS = {
  COLOR_BG,
  COLOR_SURFACE,
  COLOR_SURFACE_ALT,
  COLOR_PRIMARY,
  COLOR_PRIMARY_HOVER,
  COLOR_PRIMARY_SOFT,
  COLOR_PRIMARY_DEEP,
  COLOR_PRIMARY_DEEP_HOVER,
  COLOR_TEXT,
  COLOR_TEXT_MUTED,
  COLOR_TEXT_INVERSE,
  COLOR_BORDER,
  COLOR_BORDER_STRONG,
  COLOR_SUCCESS,
  COLOR_WARNING,
  COLOR_ERROR,
  VP_SKY_TOP,
  VP_SKY_BOTTOM,
  VP_GROUND,
  VP_GRID,
  VP_GRID_MAJOR,
  VP_HORIZON,
  VP_SELECTION,
  VP_COMPONENT_DEFAULT,
} as const;

/** 聚合导出（便于整包引用与测试断言） */
export const THEME = {
  colorBg: COLOR_BG,
  colorSurface: COLOR_SURFACE,
  colorSurfaceAlt: COLOR_SURFACE_ALT,
  colorPrimary: COLOR_PRIMARY,
  colorPrimaryHover: COLOR_PRIMARY_HOVER,
  colorPrimarySoft: COLOR_PRIMARY_SOFT,
  colorPrimaryDeep: COLOR_PRIMARY_DEEP,
  colorPrimaryDeepHover: COLOR_PRIMARY_DEEP_HOVER,
  colorText: COLOR_TEXT,
  colorTextMuted: COLOR_TEXT_MUTED,
  colorTextInverse: COLOR_TEXT_INVERSE,
  colorBorder: COLOR_BORDER,
  colorBorderStrong: COLOR_BORDER_STRONG,
  colorSuccess: COLOR_SUCCESS,
  colorWarning: COLOR_WARNING,
  colorError: COLOR_ERROR,
  vp: {
    skyTop: VP_SKY_TOP,
    skyBottom: VP_SKY_BOTTOM,
    ground: VP_GROUND,
    grid: VP_GRID,
    gridMajor: VP_GRID_MAJOR,
    horizon: VP_HORIZON,
    selection: VP_SELECTION,
    componentDefault: VP_COMPONENT_DEFAULT,
  },
} as const;
