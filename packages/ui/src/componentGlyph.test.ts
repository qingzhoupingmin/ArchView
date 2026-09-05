/**
 * 组件图形映射闸门（P3 阶段 C）。
 *
 * 与 tokens.test.ts 同一套思路：component-lib/data/components.json 是「贡献者无需写 TS
 * 即可扩充」的纯数据，而 ComponentGlyph 的映射表是 TS —— 两者一旦脱节，新增组件就会
 * 静默掉进分类兜底（图标能显示但不对题）。这里把它变成 CI 红灯。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GLYPH_BY_CATEGORY,
  GLYPH_BY_TYPE_ID,
  resolveComponentGlyph,
} from './glyph-data';

interface ComponentJsonItem {
  id: string;
  category: string;
}

/** 直接读 JSON 源文件，避免为了一个测试给原语包加上 component-lib 依赖 */
function componentIds(): ComponentJsonItem[] {
  const p = fileURLToPath(new URL('../../component-lib/data/components.json', import.meta.url));
  return JSON.parse(readFileSync(p, 'utf8')) as ComponentJsonItem[];
}

describe('组件图形映射（ComponentGlyph）', () => {
  it('components.json 的每个组件都登记了专属图形', () => {
    const missing = componentIds()
      .filter((c) => !(c.id in GLYPH_BY_TYPE_ID))
      .map((c) => c.id);
    expect(missing, '以下组件缺图形登记，会掉进分类兜底：' + missing.join(', ')).toEqual([]);
  });

  it('映射表没有指向已删除组件的僵尸条目', () => {
    const ids = new Set(componentIds().map((c) => c.id));
    const stale = Object.keys(GLYPH_BY_TYPE_ID).filter((id) => !ids.has(id));
    expect(stale, '以下 typeId 已不存在，请从映射表移除：' + stale.join(', ')).toEqual([]);
  });

  it('每个分类都有兜底图形（新增分类时须同步补登记）', () => {
    const categories = new Set(componentIds().map((c) => c.category));
    const uncovered = [...categories].filter((c) => !(c in GLYPH_BY_CATEGORY));
    expect(uncovered, '以下分类无兜底图形：' + uncovered.join(', ')).toEqual([]);
  });

  it('未知组件回落分类图形，未知分类回落通用立方体', () => {
    expect(resolveComponentGlyph('brand-new-widget', 'it')).toBe('rack');
    expect(resolveComponentGlyph('brand-new-widget', 'unknown-cat')).toBe('generic');
    expect(resolveComponentGlyph('brand-new-widget')).toBe('generic');
  });

  it('内置组件共 53 项（产品文档 §6.5 表格计数，T2.9 扩充）', () => {
    expect(componentIds()).toHaveLength(53);
  });
});
