import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BRAND_MARK, BrandMark } from '@archview/ui';

/**
 * 品牌位渲染闸门（与 packages/ui/src/brand.test.ts 同一思路，管另一端）：
 * brand.test.ts 锁「favicon.svg ↔ BRAND_MARK 几何同源」，这里锁「组件画得对 + 四处品牌位真的用了它」。
 * 渐变 id 走 useId 并去掉冒号——url(#:r1:) 这类片段在部分 CSS 解析路径里取不到画笔，
 * 于是 logo 会退化成没有底色的空心框，这类问题只在浏览器里看得见，所以在这里钉死。
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('品牌位渲染（BrandMark）', () => {
  it('渲染出圆角底板 + AV 主折线 + A 横杠，底色吃 theme token', () => {
    const html = renderToStaticMarkup(<BrandMark size={20} />);
    expect(html).toContain('class="brand-mark"');
    expect(html).toContain('rx="' + BRAND_MARK.plate.rx + '"');
    expect(html).toContain('d="' + BRAND_MARK.markPath + '"');
    expect(html).toContain('d="' + BRAND_MARK.barPath + '"');
    expect(html).toContain('stop-color:var(--color-primary)');
    expect(html).toContain('stop-color:var(--color-primary-deep)');
    expect(html).not.toContain('border-radius');
  });

  it('多实例的渐变 id 各自唯一且不含冒号', () => {
    const html = renderToStaticMarkup(
      <div>
        <BrandMark />
        <BrandMark />
      </div>,
    );
    const ids = [...html.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size, '两实例抢同一渐变 id，后一个会失去底色').toBe(2);
    for (const id of ids) {
      expect(id).not.toContain(':');
      expect(html).toContain('url(#' + id + ')');
    }
  });

  it('默认 aria-hidden，传 label 才升级为 img 语义', () => {
    const plain = renderToStaticMarkup(<BrandMark />);
    expect(plain).toContain('aria-hidden="true"');
    const labelled = renderToStaticMarkup(<BrandMark label="ArchView" />);
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="ArchView"');
    expect(labelled).not.toContain('aria-hidden');
  });

  it('四处品牌位都换成字标，粉色圆点规则全站清除', () => {
    for (const rel of [
      './components/AppHeader.tsx',
      './components/TopBar.tsx',
      './pages/AdminPage.tsx',
      './pages/LoginPage.tsx',
    ]) {
      const src = read(rel);
      expect(src, rel + ' 仍缺 <BrandMark>').toContain('<BrandMark');
      expect(src, rel + ' 仍残留圆点品牌位').not.toMatch(/logo-dot/);
    }
    const styles = read('./styles/layout.css') + read('./styles/login.css');
    expect(styles, '样式里仍残留 .topbar-logo-dot / .login-logo-dot').not.toMatch(/logo-dot\s*\{/);
    expect(styles).toContain('.brand-mark');
  });
});