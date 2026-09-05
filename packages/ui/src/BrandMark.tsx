import { useId } from 'react';

/**
 * 品牌图形「AV 一笔连字」（产品文档 §10.2 品牌 / §10.5 登录页字标）。
 *
 * 由来：此前全站四处品牌位（登录页 / 建模顶栏 / 应用页头 / 管理中心侧栏）都只是
 * 一个 14~18px 的纯粉圆点——它同时是「选中态」的语义色（§10.2 原则 1），却又不像任何
 * 标识，用户记不住。这里换成可读的 AV 字标：A 的右斜腿与 V 的左斜腿**共用同一条斜笔**，
 * 一条折线 ∧∨ 同时读出两个字母，而这条折线本身又是屋脊线 / 体量轮廓——
 * 与登录页那组纯 CSS 建筑线稿同一语言，零图片资源、随主题变色。
 *
 * 几何唯一真源是 apps/web/public/favicon.svg（浏览器页签用），本组件与之逐字一致的约束
 * 由 packages/ui/src/brand.test.ts 把关；位图 ico/png 由 scripts/brand/gen-favicon.mjs 解析生成。
 */
export const BRAND_MARK = {
  /** 画布边长（viewBox 单位，与 favicon.svg 同） */
  canvas: 32,
  /** 底板：圆角方（rx=9）；想回到「圆」把 rx 改成 15 即可，一处生效 */
  plate: { x: 1, y: 1, w: 30, h: 30, rx: 9 },
  /** 渐变轴（32 单位坐标下的 135° 方向，与 favicon.svg 同值） */
  gradient: { x1: 4, y1: 3, x2: 28, y2: 29 },
  /** 主折线：A 左腿 → 峰顶 → 共享斜笔 → 谷底 → V 右腿 */
  markPath: 'M6.1 24L12.7 8L19.3 24L25.9 8',
  /** A 的横杠：居中于峰顶 x=12.7，两端各内缩 1.2 以避开斜笔描边 */
  barPath: 'M9.6 18.6L15.8 18.6',
  /** 组件内默认描边；favicon 因物理尺寸小改用 3.2（见 favicon.svg） */
  strokeWidth: 2.8,
  /** 字形颜色固定白：--color-text-inverse 在暗色主题下是深色，不能作为品牌底上的字色 */
  ink: '#FFFFFF',
} as const;

export interface BrandMarkProps {
  /** 渲染边长 px，默认 24（页头档）；登录页 30、顶栏与管理中心侧栏 20 */
  size?: number;
  /** 描边粗细（32 画布单位）：≤20px 小档可提到 3.2 保持醒目 */
  strokeWidth?: number;
  className?: string;
  /** 无障碍名称：仅当图形独立表意（旁边没有 ArchView 文字）时传，否则默认 aria-hidden */
  label?: string;
}

/** 品牌图形。默认作为「ArchView」文字的同义装饰存在（aria-hidden），不参与朗读。 */
export function BrandMark({
  size = 24,
  strokeWidth = BRAND_MARK.strokeWidth,
  className,
  label,
}: BrandMarkProps) {
  const { canvas, plate, gradient, markPath, barPath, ink } = BRAND_MARK;
  // 渐变 id 必须逐实例唯一（页头与顶栏可能同屏），且要去掉 useId 的冒号——
  // url(#:r1:) 这种片段在某些 CSS 解析路径里会取不到画笔。
  const gid = 'av-grad' + useId().replace(/:/g, '');
  const labelled = label !== undefined;

  return (
    <svg
      viewBox={`0 0 ${canvas} ${canvas}`}
      width={size}
      height={size}
      className={className ? 'brand-mark ' + className : 'brand-mark'}
      role={labelled ? 'img' : undefined}
      aria-hidden={labelled ? undefined : true}
      aria-label={label}
      focusable={false}
    >
      <defs>
        <linearGradient
          id={gid}
          x1={gradient.x1}
          y1={gradient.y1}
          x2={gradient.x2}
          y2={gradient.y2}
          gradientUnits="userSpaceOnUse"
        >
          {/* stop-color 用 style 而非属性：CSS 变量在 presentation attribute 里不被解析，
              走 style 才能一起吃 theme token（暗色模式 --color-primary 自动换值） */}
          <stop offset="0" style={{ stopColor: 'var(--color-primary)' }} />
          <stop offset="1" style={{ stopColor: 'var(--color-primary-deep)' }} />
        </linearGradient>
      </defs>
      <rect
        x={plate.x}
        y={plate.y}
        width={plate.w}
        height={plate.h}
        rx={plate.rx}
        fill={`url(#${gid})`}
      />
      <g
        fill="none"
        stroke={ink}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={markPath} />
        <path d={barPath} />
      </g>
    </svg>
  );
}
