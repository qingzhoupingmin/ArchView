/**
 * i18n 框架单测（T4.2 · 方案 B）。
 *
 * 纯函数断言 + 资源结构闸门（node 环境，与 brand.render.test.tsx 同一口径，不引 jsdom）：
 * - 初始化状态（默认语言 / 兜底 / 已初始化标记）；
 * - `t()` 解析 + 插值（本批首个真实 key：`api.requestFailed`）；
 * - 缺 key 行为（返回 key 本身、不抛错、不返回 null）；
 * - `zh-CN.json` 结构（叶子非空字符串、key 小写字母开头）——防资源文件变成「键值杂物间」。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import i18n, { t } from './index';

describe('i18n 框架（T4.2）', () => {
  it('初始化：默认语言与兜底均为 zh-CN（v1 仅中文，预留英文位）', () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.language).toBe('zh-CN');
    // i18next 会把 fallbackLng 规范化为数组（'zh-CN' → ['zh-CN']）
    expect(i18n.options.fallbackLng).toEqual(['zh-CN']);
  });

  it('t() 解析中文文案 + 插值（首个真实 key：api.requestFailed）', () => {
    expect(t('api.requestFailed', { status: 503 })).toBe('请求失败（503）');
  });

  it('缺 key：返回 key 本身（不抛错、不返回 null，UI 上直接暴露）', () => {
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('zh-CN.json 结构：叶子为非空字符串、key 小写字母开头、文件非空', () => {
    const raw = readFileSync(fileURLToPath(new URL('./zh-CN.json', import.meta.url)), 'utf8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    let leaves = 0;
    const walk = (node: Record<string, unknown>): void => {
      for (const [k, v] of Object.entries(node)) {
        expect(k, `key「${k}」须小写字母开头（两级 domain.item 约定）`).toMatch(/^[a-z][a-zA-Z0-9]*$/);
        if (typeof v === 'string') {
          expect(v.trim(), `叶子「${k}」须为非空文案`).not.toBe('');
          leaves += 1;
        } else if (typeof v === 'object' && v !== null) {
          walk(v as Record<string, unknown>);
        } else {
          expect.fail(`「${k}」叶子须为字符串或嵌套对象，实际 ${typeof v}`);
        }
      }
    };
    walk(data);
    expect(leaves, '资源文件不得为空').toBeGreaterThan(0);
  });
});
