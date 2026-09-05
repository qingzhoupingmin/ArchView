/**
 * 品牌图形同源闸门（与 tokens.test.ts 同一套思路）。
 *
 * AV 字标的几何在三个地方必须一致，否则会出现「页内 logo 与页签图标长得不一样」：
 *   ① packages/ui/src/BrandMark.tsx 的 BRAND_MARK 常量（页内四处品牌位）
 *   ② apps/web/public/favicon.svg（浏览器页签 / 书签）
 *   ③ apps/web/public/favicon.ico|png（旧浏览器兜底，由 scripts/brand/gen-favicon.mjs 从 ② 解析生成）
 * 这里把「逐字对齐」变成红灯；色值再额外对一次 theme token，防止改了一边忘了另一边。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BRAND_MARK } from './BrandMark';

/** 仓库根：本文件位于 packages/ui/src/ */
const root = new URL('../../../', import.meta.url);
const read = (rel: string) => fileURLToPath(new URL(rel, root));

function load(rel: string): string {
  const p = read(rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

const favicon = load('apps/web/public/favicon.svg');
const indexHtml = load('apps/web/index.html');
const tokensCss = load('packages/theme/src/tokens.css');

describe('AV 字标三处同源（BrandMark / favicon.svg / index.html）', () => {
  it('favicon.svg 的画布与底板几何逐字等于 BRAND_MARK', () => {
    const p = BRAND_MARK.plate;
    expect(favicon).toContain(`viewBox="0 0 ${BRAND_MARK.canvas} ${BRAND_MARK.canvas}"`);
    expect(
      favicon.includes(`<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${p.rx}"`),
      '底板几何与 BRAND_MARK.plate 脱节，请同步 favicon.svg',
    ).toBe(true);
  });

  it('favicon.svg 的两条笔画与 BRAND_MARK 一致（顺序：AV 主折线 → A 横杠）', () => {
    const ds = [...favicon.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
    expect(ds, 'favicon.svg 的 path 必须恰好是「主折线 + 横杠」两条').toEqual([
      BRAND_MARK.markPath,
      BRAND_MARK.barPath,
    ]);
  });

  it('favicon 渐变两端色值就是 theme 的 --color-primary / --color-primary-deep', () => {
    const stops = [...favicon.matchAll(/stop-color="#([0-9A-Fa-f]{6})"/g)].map((m) =>
      m[1].toLowerCase(),
    );
    expect(stops.length).toBe(2);
    // 只比 :root 浅色段（暗色段主色本就不同）
    const lightBlock = tokensCss.slice(0, tokensCss.indexOf(':root[data-theme'));
    expect(lightBlock, `favicon 起始色 #${stops[0]} 不再是 --color-primary`).toContain(
      `--color-primary: #${stops[0]}`,
    );
    expect(lightBlock, `favicon 结束色 #${stops[1]} 不再是 --color-primary-deep`).toContain(
      `--color-primary-deep: #${stops[1]}`,
    );
  });

  it('index.html 挂了页签图标：svg 为首选、ico / apple-touch-icon 兜底', () => {
    expect(indexHtml).toContain('rel="icon"');
    expect(indexHtml, '缺少 SVG 图标（现代浏览器首选）').toContain('/favicon.svg');
    expect(indexHtml, '缺少 ico 兜底').toContain('/favicon.ico');
    expect(indexHtml, '缺少 apple-touch-icon').toContain('/favicon-180.png');
  });

  it('位图兜底产物存在且非空（改过 favicon.svg 请重跑 pnpm brand:favicon）', () => {
    for (const [file, minBytes] of [
      ['apps/web/public/favicon.ico', 256],
      ['apps/web/public/favicon-32.png', 64],
      ['apps/web/public/favicon-180.png', 256],
    ] as const) {
      const p = read(file);
      expect(existsSync(p), `缺少 ${file}，请跑 pnpm brand:favicon`).toBe(true);
      expect(statSync(p).size, `${file} 体积异常，请重跑 pnpm brand:favicon`).toBeGreaterThan(
        minBytes,
      );
    }
  });
});
