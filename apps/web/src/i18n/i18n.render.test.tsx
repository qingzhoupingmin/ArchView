/**
 * i18n React 路径验证（T4.2 · 方案 B）：`useTranslation()` 在 node 环境
 * （renderToStaticMarkup）即可解析——与 brand.render.test.tsx / StatsPanel.test.tsx
 * 同一口径，不引 jsdom。探针组件只存在于本测试，不进生产 bundle。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import i18n from './index';

function I18nProbe() {
  const { t } = useTranslation();
  return <span className="i18n-probe">{t('api.requestFailed', { status: 418 })}</span>;
}

describe('i18n React 路径（useTranslation）', () => {
  it('组件内渲染中文 + 插值', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <I18nProbe />
      </I18nextProvider>,
    );
    expect(html).toContain('class="i18n-probe"');
    expect(html).toContain('请求失败（418）');
  });
});
