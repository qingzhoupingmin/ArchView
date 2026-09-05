/**
 * 统计页签单测（T3.2 / FR-A01）。
 *
 * 用 renderToStaticMarkup（node 环境，与 brand.render.test.tsx 同一套路）而不是拉 jsdom：
 * 本组件的验收风险全在「数字与文案对不对」，交互（展开 / 点选）是纯 class 切换，
 * 为它引一个 DOM 环境不值当。真正的 WebGL 表现仍归主人的浏览器验收清单。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSampleProject } from '@archview/component-lib';
import StatsPanel, { kW, pct, rateClass } from './StatsPanel';
import { useAppStore } from '../store/useAppStore';
import { useDocumentStore } from '../store/useDocumentStore';

describe('统计页签的显示口径', () => {
  it('kW：≥ 10 kW 取整、否则留一位小数（115.1 kW 被打成 115 kW 要有据可查）', () => {
    expect(kW(0)).toBe('0.0 kW');
    expect(kW(8000)).toBe('8.0 kW');
    expect(kW(9999)).toBe('10.0 kW');
    expect(kW(115100)).toBe('115 kW');
    expect(kW(160000)).toBe('160 kW');
  });

  it('pct：null 显示「—」而不是 0%（无额定 ≠ 空机房满载 0%）', () => {
    expect(pct(null)).toBe('—');
    expect(pct(0)).toBe('0.0%');
    expect(pct(0.7194)).toBe('71.9%');
    expect(pct(1.2)).toBe('120.0%');
  });

  it('rateClass 三档阈值（边界值 0.8 与 1.0 都不算越线）', () => {
    expect(rateClass(null)).toBe('');
    expect(rateClass(0.5)).toBe(' is-ok');
    expect(rateClass(0.8)).toBe(' is-ok');
    expect(rateClass(0.81)).toBe(' is-warn');
    expect(rateClass(1)).toBe(' is-warn');
    expect(rateClass(1.01)).toBe(' is-error');
  });
});

describe('统计页签渲染（黄金样例 = 回归 fixture）', () => {
  const html = () => renderToStaticMarkup(<StatsPanel />);

  beforeAll(() => {
    useAppStore.getState().setReadOnly(false);
    useDocumentStore.getState().loadProject(loadSampleProject(), 'p-test');
    // 自动成排（D3 那颗按钮）：一次识别应得 A 排 + B 排
    const res = useDocumentStore.getState().autoArrangeRows();
    expect(res).toEqual({ created: 2, assigned: 20 });
  });

  it('机房总计出数：额定 160 kW / 负载 115 kW / 利用率 71.9% / 26 组件 20 机柜', () => {
    const out = html();
    expect(out).toContain('160 kW');
    expect(out).toContain('115 kW');
    expect(out).toContain('71.9%');
    expect(out).toContain('26 / 20');
  });

  it('三级结构的顶层出齐：A 排、B 排各 10 台，散件进「未成排」而不是被静默丢掉', () => {
    const out = html();
    expect(out).toContain('分排（2）');
    expect(out).toContain('A 排');
    expect(out).toContain('B 排');
    expect(out).toContain('未成排');
    expect(out).toContain('10 台');
    expect(out).toContain('6 台');
  });

  it('"未填 N 台"提示可见（防「没填」冒充「省电」）', () => {
    expect(html()).toContain('6 个组件未填实际负载');
  });

  it('柜级明细默认折叠：未展开时不渲染单台柜名', () => {
    expect(html()).not.toContain('点击选中该组件');
  });

  it('空工程：显示引导文案、无 NaN、无功率条（额定为 0 走「—」）', () => {
    useDocumentStore.getState().createLocal('空工程');
    const out = html();
    expect(out).not.toContain('NaN');
    expect(out).toContain('还没有排');
    expect(out).toContain('0.0 kW');
    expect(out).not.toContain('stats-bar');
  });
});
