/**
 * @archview/ui —— 跨页复用的 React 原语（P3 起正式启用）。
 *
 * 此前这个包只有一个 UI_VERSION 占位，所有按钮 / 输入框都在 apps/web 里靠字符串拼
 * className 复用，于是出现了「AppHeader 与 TopBar 各写一份用户菜单并已经行为漂移」这类问题。
 * 阶段 C 从这里开始收口：先立图标与菜单两块地基，后续原语按需增补。
 */
export { BRAND_MARK, BrandMark, type BrandMarkProps } from './BrandMark';
export { Icon, type IconName, type IconProps } from './Icon';
export { Svg, STROKE_PROPS, type SvgProps } from './svg';
export { ComponentGlyph, type ComponentGlyphProps } from './ComponentGlyph';
// 图形资产表（Phase 6 与组件本体分离）：数据 + 两级映射 + 解析，供单测与组件库校验
export {
  GLYPH_BY_CATEGORY,
  GLYPH_BY_TYPE_ID,
  resolveComponentGlyph,
  type ComponentGlyphName,
} from './glyph-data';
export { UserMenu } from './UserMenu';
