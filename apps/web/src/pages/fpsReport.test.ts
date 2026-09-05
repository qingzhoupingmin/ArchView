import { describe, expect, it } from 'vitest';
import { REPORT_COLUMNS, REPORT_CSV_COLUMNS, reportCells, reportMarkdown, type ReportRow } from './fpsReport';

/**
 * 基线报告纯函数单测（S2.0d / T3.6）。
 * 这层之所以值得单独测：报告的唯一用途是**抄进开发计划的基线表**，
 * 一处列序错位就是「1000 组件那行的帧率被当成 100 组件的」这种误导性数据。
 */
const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  scenario: '10×10 机柜阵列',
  mode: '合批 on · 阴影 on · 细节 far',
  components: 100,
  calls: 14,
  buckets: 10,
  triangles: 218800,
  idleMin: 58,
  idleAvg: 60,
  orbitMin: 55,
  orbitAvg: 59,
  verdict: '达标',
  ...over,
});

describe('报告单元格', () => {
  it('列数与表头严格一一对应（多一列少一列都会把整张表带歪）', () => {
    expect(reportCells(row())).toHaveLength(REPORT_COLUMNS.length);
    expect(REPORT_CSV_COLUMNS).toHaveLength(REPORT_COLUMNS.length);
  });

  it('第二列永远是档位：16 格混在一张表里靠它追溯是哪组 URL 跑的', () => {
    expect(REPORT_COLUMNS[1]).toBe('档位');
    expect(reportCells(row())[1]).toBe('合批 on · 阴影 on · 细节 far');
  });

  it('关批时桶数为 0 → 显示「—」而不是 0（0 桶会被读成「合批生效但没合到东西」）', () => {
    expect(reportCells(row({ buckets: 0 }))[4]).toBe('—');
    expect(reportCells(row({ buckets: 7 }))[4]).toBe('7');
  });

  it('三角形数以 k 为单位、保留一位小数', () => {
    expect(reportCells(row({ triangles: 218800 }))[5]).toBe('218.8k');
  });

  it('帧率两列都是 min / avg 成对（判定看 min，看 avg 会高估体验）', () => {
    const cells = reportCells(row());
    expect(cells[6]).toBe('58 / 60');
    expect(cells[7]).toBe('55 / 59');
  });
});

describe('Markdown 报告', () => {
  it('三行结构齐全：表头 / 分隔行 / 数据行，可直接粘进开发计划', () => {
    const md = reportMarkdown([row()]);
    const lines = md.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('场景');
    expect(lines[1]).toMatch(/^\|[ :|-]+\|$/);
    expect(lines[2]).toContain('10×10 机柜阵列');
  });

  it('空报告也要产出合法表头（复制按钮在没数据时是禁用的，函数本身不许抛）', () => {
    const md = reportMarkdown([]);
    expect(md.split('\n')).toHaveLength(2);
  });

  it('单元格里的竖线被转义：场景名一带 | 就会把整列切歪，且歪得肉眼看不出', () => {
    const md = reportMarkdown([row({ scenario: '20×20 | 密集' })]);
    expect(md).toContain('20×20 \\| 密集');
    // 转义后的行仍然是 10 个未转义竖线（9 列 → 10 个分隔符）
    const line = md.split('\n')[2];
    expect(line.split(/(?<!\\)\|/)).toHaveLength(11);
  });
});

describe('CSV 列定义', () => {
  it('每列取值都落在同一份 reportCells 上（页面 / Markdown / CSV 三口径同源）', () => {
    const r = row();
    const viaColumns = REPORT_CSV_COLUMNS.map((c) => c.value(r));
    const viaCells = reportCells(r);
    expect(viaCells).toEqual(viaColumns);
  });

  it('表头与列顺序等于 REPORT_COLUMNS（Excel 打开时列名与页面对得上）', () => {
    expect(REPORT_CSV_COLUMNS.map((c) => c.header)).toEqual([...REPORT_COLUMNS]);
  });
});
