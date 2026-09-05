/**
 * i18n 框架（T4.2 · 方案 B：只立框架 + 新文案走 key，存量文案挂账 P3 抽取）。
 *
 * 口径（开发计划 §6）：v1 仅中文，但用户可见文案一律 `t('key')`，key 集中在
 * `./zh-CN.json`（预留英文命名空间，产品文档 §7 / O5 决策不变）。
 *
 * 两条调用路径：
 * - React 组件：`useTranslation()`（`main.tsx` 已用 `I18nextProvider` 注入本实例）；
 * - 非 React 上下文（store / api client / saveService 等）：`import { t } from './i18n'`。
 *
 * key 约定：两级 `domain.item`（小写字母开头）；叶子值中文句子，插值用 `{{var}}`。
 * 本批首个真实 key：`api.requestFailed`（API 兜底错误，见 `api/client.ts`）——
 * 存量文案不抽（方案 B 口径），新增文案一律先来这里登记再上屏。
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './zh-CN.json';

void i18n.use(initReactI18next).init({
  // v1 仅中文：默认语言与兜底同为 zh-CN；resources 结构已预留 `en` 命名空间位置
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  resources: {
    'zh-CN': { translation: zhCN },
  },
  interpolation: {
    // React 文本默认已 HTML 转义，关掉 escapeValue 防双重转义（i18next 官方约定）
    escapeValue: false,
  },
  // 缺 key：返回 key 本身（不抛错、不返回 null）——UI 上直接看到裸 key 便于暴露，
  // 单测闸门（i18n.test.ts）另锁资源结构，两条防线
  parseMissingKeyHandler: (key) => key,
  returnNull: false,
});

/**
 * 非 React 上下文的翻译入口（api client / store / saveService 等）。
 * 注意：直连 `i18n.t`，不参与 React 订阅重渲染——只用于「非组件」场景；
 * 组件里必须用 `useTranslation()`，否则语言切换时不刷新（v1 单语言无感，英文启动后有感）。
 */
export function t(key: string, options?: Record<string, unknown>): string {
  return String(i18n.t(key, options));
}

export default i18n;
