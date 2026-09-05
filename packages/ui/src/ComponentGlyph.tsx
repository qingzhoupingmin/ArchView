import { Svg } from './svg';
import { GLYPHS, resolveComponentGlyph } from './glyph-data';

export type { ComponentGlyphName } from './glyph-data';

/**
 * 组件库图形（P3 阶段 C）。
 *
 * 取代 component-lib/data/components.json 里的 emoji icon 字段。为什么不改 JSON：
 * 该文件是「社区贡献者无需写 TS 即可扩充」的纯数据（§12 开源策略），把图形语义写进 JSON
 * 反而要求贡献者先了解有哪些 key。这里按 typeId 精确映射、按 category 兜底，
 * 新增组件即便没登记图标也能拿到一个分类图形 —— 彻底消灭此前 ▣ / ▭ 渲染成空心方框、
 * 以及 emoji 在 Win / macOS / Linux 三平台长得不一样的问题。
 *
 * 图形规格与 Icon 完全一致（见 ./svg.tsx），因此吃同一套 currentColor 主题色。
 * 数据表（路径与两级映射）在 ./glyph-data.tsx，本文件只留渲染。
 */

export interface ComponentGlyphProps {
  typeId: string;
  category?: string;
  size?: number;
  className?: string;
}

/** 组件库卡片上的图形。装饰性，语义由旁边的组件名承担，故不带 label。 */
export function ComponentGlyph({ typeId, category, size, className }: ComponentGlyphProps) {
  return (
    <Svg size={size} className={className}>
      {GLYPHS[resolveComponentGlyph(typeId, category)]}
    </Svg>
  );
}
