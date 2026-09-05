/**
 * 电力统计报表单测（T3.3 / FR-A05）：从 core 的真实统计结果一路验到 CSV 文本。
 * 断言写成整串精确匹配——报表这种东西，错一列顺序、少一个空值，肉眼在 Excel 里才发现就晚了。
 */
import {
  AddRowCommand,
  Document,
  createComponent,
  createEmptyProject,
  summarizeProject,
  type ComponentType,
} from '@archview/core';
import { describe, expect, it } from 'vitest';
import { powerReportCsv, powerReportRows } from './powerReport';

const rackType: ComponentType = {
  id: 'it-rack42',
  name: '机柜',
  category: 'it',
  defaultSize: { w: 600, d: 1000, h: 2000 },
  geometry: [],
  defaultAttrs: { ratedPowerW: 8000 },
  uSlots: 42,
};
const acType: ComponentType = {
  id: 'cooling-ac',
  name: '精密空调',
  category: 'ac',
  defaultSize: { w: 1200, d: 900, h: 1900 },
  geometry: [],
  defaultAttrs: { coolingKW: 50 },
};

function makeStats() {
  const doc = new Document(createEmptyProject());
  doc.project.types.push(rackType, acType);
  doc.addComponent({
    ...createComponent(rackType, { x: 0, y: 0, z: 0 }),
    id: 'a1',
    name: 'A01',
    attrs: { ratedPowerW: 8000, actualLoadW: 5000 },
  });
  doc.addComponent({
    ...createComponent(rackType, { x: 600, y: 0, z: 0 }),
    id: 'a2',
    name: 'A02',
    attrs: { ratedPowerW: 8000, actualLoadW: 3000 },
  });
  doc.addComponent({
    ...createComponent(acType, { x: 0, y: 0, z: 3000 }),
    id: 'ac1',
    name: 'AC-1',
  });
  doc.execute(new AddRowCommand({ id: 'r1', name: 'A 排' }, ['a1', 'a2']));
  return summarizeProject(doc.project, (id) => doc.getType(id));
}

describe('powerReportRows（三级展平）', () => {
  it('顺序 = 机房 → 排 → 该排柜明细 → 未成排 → 其成员，且「上级」列串得起', () => {
    const rows = powerReportRows(makeStats(), '演示机房');
    expect(rows.map((r) => [r.level, r.name, r.parent])).toEqual([
      ['机房', '演示机房', ''],
      ['排', 'A 排', '演示机房'],
      ['机柜', 'A01', 'A 排'],
      ['机柜', 'A02', 'A 排'],
      ['未成排', '未成排', '演示机房'],
      ['机柜', 'AC-1', '未成排'],
    ]);
  });

  it('数字口径：W → kW 两位小数无损、利用率百分数数值、未填数逐层带出', () => {
    const rows = powerReportRows(makeStats(), '演示机房');
    expect(rows[0]).toMatchObject({
      ratedKW: 16,
      loadKW: 8,
      loadPct: 50,
      unmeasured: 1,
      count: 3,
    });
    expect(rows[2]).toMatchObject({ ratedKW: 8, loadKW: 5, loadPct: 62.5, unmeasured: 0 });
  });

  it('无额定的成员：利用率留 null（导出成空格），绝不写 0 冒充「空载」', () => {
    const rows = powerReportRows(makeStats(), '演示机房');
    const ac = rows.find((r) => r.name === 'AC-1');
    expect(ac?.ratedKW).toBe(0);
    expect(ac?.loadKW).toBe(0);
    expect(ac?.loadPct).toBeNull();
    expect(ac?.unmeasured).toBe(1);
  });

  it('withUnits=false 只出机房 + 排两级（面板上的短表）', () => {
    const rows = powerReportRows(makeStats(), '演示机房', { withUnits: false });
    expect(rows.map((r) => r.level)).toEqual(['机房', '排', '未成排']);
  });
});

describe('powerReportCsv（最终文本）', () => {
  it('整串精确匹配：BOM + 中文表头 + CRLF + 空值留空', () => {
    const csv = powerReportCsv(makeStats(), '演示机房');
    expect(csv).toBe(
      '\uFEFF' +
        '层级,名称,上级,台数,额定功率(kW),实际负载(kW),容量利用率(%),未填负载台数\r\n' +
        '机房,演示机房,,3,16,8,50,1\r\n' +
        '排,A 排,演示机房,2,16,8,50,0\r\n' +
        '机柜,A01,A 排,1,8,5,62.5,0\r\n' +
        '机柜,A02,A 排,1,8,3,37.5,0\r\n' +
        '未成排,未成排,演示机房,1,0,0,,1\r\n' +
        '机柜,AC-1,未成排,1,0,0,,1\r\n',
    );
  });

  it('工程名含逗号时整格加引号（否则会撑出一列）', () => {
    const csv = powerReportCsv(makeStats(), '一期, 核心区');
    // 引号内的逗号不能被 naive split 当作分隔符——所以这里直接比对整行，
    // 真要程序化解析请配 parseCsv（T3.4 导入侧再补），别用 split(',')。
    expect(csv).toContain('机房,"一期, 核心区",,3,16,8,50,1');
    expect(csv.split('\r\n')[1]).toBe('机房,"一期, 核心区",,3,16,8,50,1');
  });
});
