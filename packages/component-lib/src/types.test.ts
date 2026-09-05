import { describe, expect, it } from 'vitest';
import { componentTypes } from './index';

/**
 * 组件库数量口径（T2.1 / S2.0c / T2.9）：产品文档 §6.5 表格共 53 项（T2.9：8 项改归类 + 30 项新增）。
 * Sprint 1 期间文档与代码的口径曾漂移过一次，这里把数量钉死在测试里。
 */
describe('组件库（T2.1 / S2.0c / T2.9）', () => {
  it('预置 53 项组件，ID 无重复', () => {
    expect(componentTypes).toHaveLength(53);
    expect(new Set(componentTypes.map((t) => t.id)).size).toBe(53);
  });

  it('T2.9 新增 6 个一级分类均有组件（分类口径）', () => {
    const countOf = (c: string) => componentTypes.filter((t) => t.category === c).length;
    expect(countOf('ac')).toBeGreaterThan(0);
    expect(countOf('furniture')).toBeGreaterThan(0);
    expect(countOf('fire')).toBeGreaterThan(0);
    expect(countOf('electrical')).toBeGreaterThan(0);
    expect(countOf('rack')).toBeGreaterThan(0);
    expect(countOf('smart')).toBeGreaterThan(0);
  });
});
