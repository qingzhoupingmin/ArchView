/**
 * LOD 决策纯函数单测（S2.5 / T2.12，产品文档 §6.2 `lod` 字段）。
 * 重点锁两件事——① 迟滞带内**绝不来回切档**（切档 = 渲染层全量重建图形，抖动即掉帧）；
 * ② 手动锁定优先于距离（出图 / 密集阵列两个极端场景都要能一口咬死）。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOD_RULE,
  decideLod,
  lodPolicyLabel,
  nextLodPolicy,
  normalizeLodRule,
  type LodPolicy,
} from './lod';

const R = { nearMm: 6000, farMm: 8500 };

describe('decideLod（T2.12 相机距离升降档）', () => {
  it('手动锁定优先：锁 near / 锁 far 时无视距离', () => {
    expect(decideLod('near', 999999, 'far', R)).toBe('near');
    expect(decideLod('far', 10, 'near', R)).toBe('far');
  });

  it('auto：远观保持 far，凑近到阈值内升 near', () => {
    expect(decideLod('auto', 20000, 'far', R)).toBe('far');
    expect(decideLod('auto', 5999, 'far', R)).toBe('near');
  });

  it('auto：迟滞带内两向都保持现状（这是本卡的核心回归点）', () => {
    for (const d of [6000, 6500, 7200, 8000, 8500]) {
      expect(decideLod('auto', d, 'far', R), `${d} 不该把 far 升档`).toBe('far');
      expect(decideLod('auto', d, 'near', R), `${d} 不该把 near 降档`).toBe('near');
    }
  });

  it('auto：只有超过退档阈值才回 far（进 6m / 出 8.5m 不对称）', () => {
    expect(decideLod('auto', 8501, 'near', R)).toBe('far');
    expect(decideLod('auto', 7000, 'near', R)).toBe('near');
  });

  it('非有限距离保持原档（2D 正交顶视无距离、相机未就绪）', () => {
    expect(decideLod('auto', Infinity, 'far', R)).toBe('far');
    expect(decideLod('auto', NaN, 'near', R)).toBe('near');
  });

  it('缺省规则可用，且阈值单调（退档线必须晚于升档线）', () => {
    expect(DEFAULT_LOD_RULE.farMm).toBeGreaterThan(DEFAULT_LOD_RULE.nearMm);
    expect(decideLod('auto', 1000, 'far')).toBe('near');
  });
});

describe('normalizeLodRule / 策略循环（T2.12）', () => {
  it('退档阈值被写成小于升档阈值时自动补齐迟滞带（防抖成空档）', () => {
    expect(normalizeLodRule({ nearMm: 5000, farMm: 4000 })).toEqual({ nearMm: 5000, farMm: 5500 });
    expect(normalizeLodRule({ nearMm: 5000, farMm: 5000 }).farMm).toBeGreaterThan(5000);
  });

  it('非法输入回退默认值', () => {
    expect(normalizeLodRule(undefined)).toEqual(DEFAULT_LOD_RULE);
    expect(normalizeLodRule({ nearMm: NaN, farMm: Infinity })).toEqual(DEFAULT_LOD_RULE);
    expect(normalizeLodRule({ nearMm: -100 }).nearMm).toBe(0);
  });

  it('策略三态循环：auto → near → far → auto', () => {
    expect(nextLodPolicy('auto')).toBe('near');
    expect(nextLodPolicy('near')).toBe('far');
    expect(nextLodPolicy('far')).toBe('auto');
  });

  it('标签覆盖三态（状态栏 chip 与帮助表同源）', () => {
    const all: LodPolicy[] = ['auto', 'near', 'far'];
    expect(new Set(all.map(lodPolicyLabel)).size).toBe(3);
    expect(lodPolicyLabel('auto')).toContain('自动');
  });
});
