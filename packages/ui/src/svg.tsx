import { type ReactNode, useId } from 'react';

/**
 * 图标底座（P3 阶段 C）：全站图标的统一规格与无障碍语义集中在这里，
 * 调用方（Icon / ComponentGlyph）只提供 path 内容。
 *
 * 规格：24×24 viewBox · 1.8 描边 · 圆端点 · fill none · stroke currentColor。
 * 最后一条是关键——图标颜色从此跟随 CSS 的 color，能一起吃主题 token，
 * 这是 emoji 与彩色字符永远做不到的。
 */
export const STROKE_PROPS = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export interface SvgProps {
  /** 像素边长，默认 16 */
  size?: number;
  className?: string;
  /**
   * 无障碍名称。默认不带 —— 图标按钮的语义应由外层 <button aria-label> 承担，
   * 两处都给会被屏幕阅读器念两遍。仅在图标独立表意（无相邻文字）时传。
   */
  label?: string;
  children: ReactNode;
}

/** 描边图标底座。默认 aria-hidden，作为文字的同义装饰存在。 */
export function Svg({ size = 16, className, label, children }: SvgProps) {
  const id = useId();
  const labelled = label !== undefined;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role={labelled ? 'img' : undefined}
      aria-hidden={labelled ? undefined : true}
      aria-labelledby={labelled ? id : undefined}
      focusable={false}
    >
      {labelled && <title id={id}>{label}</title>}
      <g {...STROKE_PROPS}>{children}</g>
    </svg>
  );
}
