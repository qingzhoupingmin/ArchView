/**
 * 电力统计单测（T3.1 / FR-D02 + FR-A01）。
 *
 * 三条重点：
 * ① 「没填」绝不能冒充「省电」——unmeasured 必须独立计数，否则 M1 演示脚本里
 *    用户只填了半数机柜就会看到一片漂亮的低利用率；
 * ② 额定为 0 时 loadRate 是 null 而不是 0（「无额定」≠「满载 0%」）；
 * ③ createPowerIndex 的增量口径要用重算次数锁死——「记忆化」写在卡片里，
 *    没有探针断言就等于没做。
 */
import { describe, expect, it } from 'vitest';
import {
  AddRowCommand,
  RemoveComponentCommand,
  RemoveRowCommand,
  UpdateComponentCommand,
  UpdateRowCommand,
} from './command';
import { Document, createComponent, createEmptyProject } from './document';
import {
  UNASSIGNED_ROW_NAME,
  createPowerIndex,
  hasMeasuredLoad,
  loadPowerW,
  powerTotals,
  ratedPowerW,
  rowPower,
  summarizeProject,
} from './stats';
import type { Component, ComponentType } from './types';

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
const TYPES = new Map([rackType, acType].map((t) => [t.id, t]));
const typeOf = (typeId: string): ComponentType | undefined => TYPES.get(typeId);

function unit(over: Partial<Component> = {}): Component {
  const base = createComponent(TYPES.get(over.typeId ?? 'it-rack42') ?? rackType, {
    x: 0,
    y: 0,
    z: 0,
  });
  return { ...base, ...over };
}

describe('额定功率与负载取值（FR-D02）', () => {
  it('实例值优先于类型默认值；类型默认值兜底', () => {
    expect(ratedPowerW(unit({ attrs: { ratedPowerW: 5000 } }), rackType)).toBe(5000);
    expect(ratedPowerW(unit({ attrs: {} }), rackType)).toBe(8000); // 回退类型默认
  });

  it('非机柜件用 powerW 计额定；纯制冷件（只有 coolingKW）额定为 0', () => {
    expect(ratedPowerW(unit({ attrs: { powerW: 300 } }), rackType)).toBe(300);
    expect(ratedPowerW(unit({ typeId: 'cooling-ac', attrs: {} }), acType)).toBe(0);
  });

  it('脏值一律收成有限非负数：负功率 / NaN / null / 字符串数字 / undefined', () => {
    expect(ratedPowerW(unit({ attrs: { ratedPowerW: -5000 } }))).toBe(0);
    expect(ratedPowerW(unit({ attrs: { ratedPowerW: Number.NaN } }))).toBe(0);
    expect(ratedPowerW(unit({ attrs: { ratedPowerW: null as unknown as number } }))).toBe(0);
    expect(ratedPowerW(unit({ attrs: { ratedPowerW: '12000' } }))).toBe(12000); // 字符串数要能救回来
    expect(ratedPowerW(unit({ attrs: { ratedPowerW: 'abc' } }))).toBe(0);
  });

  it('actualLoadW 优先 → 回退 powerW（非机柜设备的功耗即其负载）→ 都没有则 0', () => {
    expect(loadPowerW(unit({ attrs: { actualLoadW: 4500, powerW: 999 } }))).toBe(4500);
    expect(loadPowerW(unit({ attrs: { actualLoadW: 0, powerW: 300 } }))).toBe(300);
    expect(loadPowerW(unit({ attrs: {} }))).toBe(0);
  });

  it('hasMeasuredLoad 与 unmeasured 计数同源（没填 ≠ 零功耗）', () => {
    expect(hasMeasuredLoad(unit({ attrs: { actualLoadW: 1 } }))).toBe(true);
    expect(hasMeasuredLoad(unit({ attrs: { powerW: 300 } }))).toBe(true);
    expect(hasMeasuredLoad(unit({ attrs: { ratedPowerW: 8000 } }))).toBe(false); // 只填额定
  });
});

describe('powerTotals / rowPower 合计口径', () => {
  it('额定为 0 时 loadRate 为 null，不是 0（无额定与空机房是两件事）', () => {
    const t = powerTotals([unit({ typeId: 'cooling-ac', attrs: {} })]);
    expect(t.ratedW).toBe(0);
    expect(t.loadRate).toBeNull();
  });

  it('合计含台数、总额定、总负载与未填数；负载率 = 负载 / 额定', () => {
    const t = powerTotals([
      unit({ attrs: { ratedPowerW: 8000, actualLoadW: 4000 } }),
      unit({ attrs: { ratedPowerW: 8000, actualLoadW: 6000 } }),
      unit({ attrs: { ratedPowerW: 4000 } }), // 未填负载
    ]);
    expect(t).toEqual({ count: 3, ratedW: 20000, loadW: 10000, unmeasured: 1, loadRate: 0.5 });
  });

  it('rowPower 保留柜级明细且比率口径与 powerTotals 一致', () => {
    const rp = rowPower('r1', 'A 排', [unit({ attrs: { ratedPowerW: 8000, actualLoadW: 2000 } })], typeOf);
    expect(rp).toMatchObject({ rowId: 'r1', name: 'A 排', count: 1, ratedW: 8000, loadRate: 0.25 });
    expect(rp.units[0]).toMatchObject({ ratedW: 8000, loadW: 2000, measured: true });
  });
});

describe('summarizeProject（FR-A01 三级：机房 / 排 / 机柜）', () => {
  const makeDoc = () => {
    const doc = new Document(createEmptyProject());
    doc.addComponent(unit({ id: 'a1', attrs: { ratedPowerW: 8000, actualLoadW: 5000 } }));
    doc.addComponent(unit({ id: 'a2', attrs: { ratedPowerW: 8000, actualLoadW: 3000 } }));
    doc.addComponent(unit({ id: 'b1', attrs: { ratedPowerW: 4000, actualLoadW: 1000 } }));
    doc.execute(new AddRowCommand({ id: 'r1', name: 'A 排' }, ['a1', 'a2']));
    doc.execute(new AddRowCommand({ id: 'r2', name: 'B 排' }, ['b1']));
    return doc;
  };

  it('排按 Project.rows 顺序输出，未成排件（若有）追加在末尾', () => {
    const doc = makeDoc();
    const out = summarizeProject(doc.project, typeOf);
    expect(out.rows.map((r) => r.name)).toEqual(['A 排', 'B 排']);
    expect(out.rows[0].loadW).toBe(8000);
    expect(out.rows[1].loadW).toBe(1000);
    doc.addComponent(unit({ id: 'loose', attrs: { ratedPowerW: 2000, actualLoadW: 500 } }));
    const out2 = summarizeProject(doc.project, typeOf);
    expect(out2.rows.map((r) => r.name)).toEqual(['A 排', 'B 排', UNASSIGNED_ROW_NAME]);
    expect(out2.rows[2].rowId).toBeNull();
    expect(out2.rows[2].loadW).toBe(500);
  });

  it('机房总计 = 各排之和（含未成排与非机柜设备），且等于 powerTotals 全量口径', () => {
    const doc = makeDoc();
    const out = summarizeProject(doc.project, typeOf);
    expect(out.project).toEqual(powerTotals(doc.project.components, typeOf));
    expect(out.project.ratedW).toBe(20000);
    expect(out.project.loadW).toBe(9000);
    expect(out.componentCount).toBe(3);
  });

  it('rackCount 只数有 U 位数的类型；空调不算机柜', () => {
    const doc = new Document(createEmptyProject());
    doc.addComponent(unit({ id: 'a1' }));
    doc.addComponent(unit({ id: 'ac1', typeId: 'cooling-ac', attrs: {} }));
    const out = summarizeProject(doc.project, typeOf);
    expect(out.rackCount).toBe(1);
    expect(out.componentCount).toBe(2);
  });
});

describe('createPowerIndex（T3.1「记忆化」：改一台只重算它所在排）', () => {
  /** A 排 2 台 + B 排 2 台，额定各 8000 */
  function makeIndexed() {
    const doc = new Document(createEmptyProject());
    const seeds: [string, number][] = [
      ['a1', 5000],
      ['a2', 3000],
      ['b1', 1000],
      ['b2', 2000],
    ];
    for (const [id, load] of seeds) {
      doc.addComponent(unit({ id, attrs: { ratedPowerW: 8000, actualLoadW: load } }));
    }
    doc.execute(new AddRowCommand({ id: 'r1', name: 'A 排' }, ['a1', 'a2']));
    doc.execute(new AddRowCommand({ id: 'r2', name: 'B 排' }, ['b1', 'b2']));
    const idx = createPowerIndex(doc, typeOf);
    return { doc, idx };
  }

  it('首次 get 建全部桶；其后无变更的 get 零重算', () => {
    const { idx } = makeIndexed();
    idx.get();
    expect(idx.stats).toEqual({ rowRecomputes: 2, fullRebuilds: 1 });
    idx.get();
    idx.get();
    expect(idx.stats.rowRecomputes).toBe(2);
    expect(idx.stats.fullRebuilds).toBe(1);
  });

  it('缓存结果与 summarizeProject 完全一致（记忆化不得改变语义）', () => {
    const { doc, idx } = makeIndexed();
    expect(idx.get()).toEqual(summarizeProject(doc.project, typeOf));
  });

  it('改一台柜的功率 → 只重算它所在的那一排，另一排复用', () => {
    const { doc, idx } = makeIndexed();
    idx.get();
    doc.execute(new UpdateComponentCommand('a1', { attrs: { ratedPowerW: 8000, actualLoadW: 8000 } }));
    const out = idx.get();
    expect(idx.stats.rowRecomputes).toBe(3); // 只多 1 桶
    expect(idx.stats.fullRebuilds).toBe(1); // 没有推倒重来
    expect(out.rows[0].loadW).toBe(11000);
    expect(out.rows[1].loadW).toBe(3000); // 未受影响
    expect(out.project.loadW).toBe(14000);
  });

  it('删除成员 → 找回它原先所在的排重算（unitRow 映射的价值：删掉的柜问不出旧归属）', () => {
    const { doc, idx } = makeIndexed();
    idx.get();
    doc.execute(new RemoveComponentCommand(['b1']));
    const out = idx.get();
    expect(idx.stats.rowRecomputes).toBe(3);
    expect(out.rows[1].count).toBe(1);
    expect(out.rows[1].loadW).toBe(2000);
    expect(out.project.count).toBe(3);
  });

  it('换排 → 新旧两个桶都重算', () => {
    const { doc, idx } = makeIndexed();
    idx.get();
    doc.setMembersRow(['a1'], 'r2');
    const out = idx.get();
    expect(idx.stats.rowRecomputes).toBe(4); // r1 + r2
    expect(out.rows[0].count).toBe(1);
    expect(out.rows[1].count).toBe(3);
    expect(out.project.loadW).toBe(11000); // 总量不因换排而变
  });

  it('删除整排（removeRow 只发 rowIds、不发 componentIds）→ 成员落进未成排桶', () => {
    const { doc, idx } = makeIndexed();
    idx.get();
    doc.execute(new RemoveRowCommand('r1'));
    const out = idx.get();
    expect(out.rows.map((r) => r.name)).toEqual(['B 排', UNASSIGNED_ROW_NAME]);
    expect(out.rows[1].count).toBe(2);
    expect(out.project.count).toBe(4); // 一台都没丢
    expect(out.project.loadW).toBe(11000);
  });

  it('排改名只脏该排（不触发全量重建）', () => {
    const { doc, idx } = makeIndexed();
    idx.get();
    doc.execute(new UpdateRowCommand('r1', { name: '冷通道 A' }));
    const out = idx.get();
    expect(out.rows[0].name).toBe('冷通道 A');
    expect(out.rows[0].loadW).toBe(8000);
    expect(idx.stats.fullRebuilds).toBe(1); // 仍是首次那一次
  });

  it('undo / redo（空 ids 通知）走全量重建，数值正确回退', () => {
    const { doc, idx } = makeIndexed();
    idx.get();
    doc.execute(new UpdateComponentCommand('a1', { attrs: { ratedPowerW: 8000, actualLoadW: 100 } }));
    expect(idx.get().project.loadW).toBe(6100);
    doc.undo(); // undo 自身也发空 ids 通知 → 全量重建
    const out = idx.get();
    expect(idx.stats.fullRebuilds).toBe(2);
    expect(out.project.loadW).toBe(11000);
  });

  it('dispose 后不再监听变更（工程切换时必须解绑，否则旧索引会一直吃通知）', () => {
    const { doc, idx } = makeIndexed();
    idx.get();
    idx.dispose();
    doc.execute(new UpdateComponentCommand('a1', { attrs: { ratedPowerW: 8000, actualLoadW: 1 } }));
    expect(idx.get().project.loadW).toBe(11000); // 缓存停在旧值，说明确实没再监听
  });
});