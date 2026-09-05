/**
 * 设备排纯函数 + 命令单测（T3.1 / 产品文档 §8.2-12）。
 *
 * 聚类部分是重点：「自动成排」按钮一旦把两条排粘成一条、或把一条切成两条，
 * 统计面板的三级数值就会整片对不上账，而这类错误在界面上看不出来（数值仍是"合理"的）。
 * 故全部判定口径在这里用坐标锁死。
 */
import { describe, expect, it } from 'vitest';
import {
  AddRowCommand,
  RemoveRowCommand,
  UpdateRowCommand,
} from './command';
import { Document, createComponent, createEmptyProject } from './document';
import {
  buildRowsFromClusters,
  componentsWithoutRow,
  inferRowClusters,
  isRackComponent,
  rowAxisOfRotation,
  rowIndexById,
  rowLabel,
  rowMembers,
  type RowCluster,
} from './row';
import { yawQuaternion } from './transform';
import type { Component, ComponentType, RackRow } from './types';

const rackType = { id: 'it-rack42', name: '机柜', uSlots: 42 } as ComponentType;

/** 机柜实例：deg 为偏航角，默认 0°（柜面朝 -Z、柜列沿 X 展开） */
function rack(
  id: string,
  x: number,
  z: number,
  deg = 0,
  over: Partial<Component> = {},
): Component {
  const base = createComponent(
    {
      ...rackType,
      defaultSize: { w: 600, d: 1000, h: 2000 },
      geometry: [],
      defaultAttrs: { ratedPowerW: 8000 },
    },
    { x, y: 0, z },
  );
  return { ...base, id, name: id, rotation: yawQuaternion(deg), ...over };
}

describe('rowLabel / isRackComponent', () => {
  it('A 排 → Z 排 → AA 排（Excel 列名式，不会在 26 条排时崩掉）', () => {
    expect(rowLabel(0)).toBe('A 排');
    expect(rowLabel(1)).toBe('B 排');
    expect(rowLabel(25)).toBe('Z 排');
    expect(rowLabel(26)).toBe('AA 排');
    expect(rowLabel(-3)).toBe('A 排'); // 负数钳到 0，不让 UI 传错就崩
  });

  it('isRackComponent 只看类型的 U 位数：与属性面板显示电力字段的条件同源', () => {
    expect(isRackComponent(rack('c1', 0, 0), rackType)).toBe(true);
    expect(isRackComponent(rack('c1', 0, 0), { ...rackType, uSlots: undefined })).toBe(false);
    expect(isRackComponent(rack('c1', 0, 0), { uSlots: 0 })).toBe(false);
    expect(isRackComponent(rack('c1', 0, 0), null)).toBe(false);
    expect(isRackComponent(rack('c1', 0, 0), undefined)).toBe(false);
  });
});

describe('rowAxisOfRotation（朝向 → 排列轴向 + 斜放剔除）', () => {
  it('0 / 180 → 沿 X；90 / 270 → 沿 Z（面对背的两排同轴，靠横向坐标分开）', () => {
    expect(rowAxisOfRotation(rack('c', 0, 0, 0).rotation)).toBe('x');
    expect(rowAxisOfRotation(rack('c', 0, 0, 180).rotation)).toBe('x');
    expect(rowAxisOfRotation(rack('c', 0, 0, 90).rotation)).toBe('z');
    expect(rowAxisOfRotation(rack('c', 0, 0, 270).rotation)).toBe('z');
  });

  it('偏离正交超过容差判为斜放（不参与自动成排）；容差内仍认', () => {
    expect(rowAxisOfRotation(rack('c', 0, 0, 45).rotation)).toBeNull();
    expect(rowAxisOfRotation(rack('c', 0, 0, 8).rotation)).toBeNull();
    expect(rowAxisOfRotation(rack('c', 0, 0, 3).rotation)).toBe('x');
    expect(rowAxisOfRotation(rack('c', 0, 0, 3).rotation, 1)).toBeNull();
  });

  it('负角度与跨 360 归一：-90 等价 270', () => {
    expect(rowAxisOfRotation(rack('c', 0, 0, -90).rotation)).toBe('z');
    expect(rowAxisOfRotation(rack('c', 0, 0, 360).rotation)).toBe('x');
  });
});

describe('inferRowClusters（按布局自动识别排）', () => {
  it('一横排三台 → 1 簇，成员按主轴升序（= 柜位 1..n 顺序）', () => {
    const out = inferRowClusters([rack('c3', 1200, 0), rack('c1', 0, 0), rack('c2', 600, 0)]);
    expect(out).toHaveLength(1);
    expect(out[0].componentIds).toEqual(['c1', 'c2', 'c3']);
    expect(out[0].axis).toBe('x');
  });

  it('两条平行横排（横向差 1200）→ 2 簇，且按横向坐标从前到后排序', () => {
    const out = inferRowClusters([
      rack('b1', 0, 1200),
      rack('b2', 600, 1200),
      rack('a1', 0, 0),
      rack('a2', 600, 0),
    ]);
    expect(out.map((c) => c.componentIds)).toEqual([
      ['a1', 'a2'],
      ['b1', 'b2'],
    ]);
  });

  it('主轴间距超上限 → 断开；落单的那台因不足 minSize 不算一排', () => {
    const out = inferRowClusters([rack('c1', 0, 0), rack('c2', 600, 0), rack('c3', 5000, 0)]);
    expect(out).toHaveLength(1);
    expect(out[0].componentIds).toEqual(['c1', 'c2']);
  });

  it('minSize 放宽到 1 时落单机也算一排（供「按现有布局重建排」场景使用）', () => {
    const out = inferRowClusters([rack('c1', 0, 0), rack('c2', 5000, 0)], { minSize: 1 });
    expect(out.map((c) => c.componentIds)).toEqual([['c1'], ['c2']]);
  });

  it('沿 Z 展开的一排（柜体转 90°）：轴向正确、主轴取 z 坐标', () => {
    const out = inferRowClusters([rack('c1', 0, 0, 90), rack('c2', 0, 600, 90)]);
    expect(out).toHaveLength(1);
    expect(out[0].axis).toBe('z');
    expect(out[0].componentIds).toEqual(['c1', 'c2']);
  });

  it('不同房间绝不并成一批；未分配房间的成员自成一桶并带 roomId', () => {
    const out = inferRowClusters(
      [
        rack('r1', 0, 0, 0, { roomId: 'room-a' }),
        rack('r2', 600, 0, 0, { roomId: 'room-a' }),
        rack('s1', 0, 12000, 0, { roomId: 'room-b' }),
        rack('s2', 600, 12000, 0, { roomId: 'room-b' }),
      ],
      { maxGap: 999999 }, // 就算允许超大间距，跨房间也不能合并
    );
    expect(out.map((c) => [c.roomId, c.componentIds])).toEqual([
      ['room-a', ['r1', 'r2']],
      ['room-b', ['s1', 's2']],
    ]);
  });

  it('斜放件与非候选件不参与成排', () => {
    const out = inferRowClusters(
      [
        rack('c1', 0, 0),
        rack('c2', 600, 0),
        rack('tilt', 1200, 0, 45),
        rack('ac', 1800, 0, 0, { attrs: { coolingKW: 50 } }), // 没 ratedPowerW = 非候选
      ],
      { maxGap: 999999 },
    );
    expect(out).toHaveLength(1);
    expect(out[0].componentIds).toEqual(['c1', 'c2']);
  });

  it('输入顺序打乱不影响结果（A/B/C 命名必须可重复，否则撤销栈会炸出不同排名）', () => {
    const a = [rack('c1', 0, 0), rack('c2', 600, 0), rack('d1', 0, 1200), rack('d2', 600, 1200)];
    const b = [rack('d2', 600, 1200), rack('c2', 600, 0), rack('d1', 0, 1200), rack('c1', 0, 0)];
    expect(inferRowClusters(a)).toEqual(inferRowClusters(b));
  });

  it('纯函数：不改入参数组与元素', () => {
    const comps = [rack('c2', 600, 0), rack('c1', 0, 0)];
    const snapshot = JSON.stringify(comps);
    inferRowClusters(comps);
    expect(JSON.stringify(comps)).toBe(snapshot);
  });
});

describe('buildRowsFromClusters / 成员查询', () => {
  const cluster = (ids: string[], roomId?: string): RowCluster => ({
    axis: 'x',
    roomId,
    componentIds: ids,
  });

  it('生成 A/B/C 命名 + 归组关系；id 由注入方决定（单测可固定，UI 传 uid）', () => {
    let n = 0;
    const out = buildRowsFromClusters([cluster(['c1', 'c2']), cluster(['d1', 'd2'], 'room-a')], {
      nextId: () => `r${++n}`,
    });
    expect(out.rows).toEqual([
      { id: 'r1', name: 'A 排' },
      { id: 'r2', name: 'B 排', roomId: 'room-a' },
    ]);
    expect(out.assignments).toEqual([
      { rowId: 'r1', componentIds: ['c1', 'c2'] },
      { rowId: 'r2', componentIds: ['d1', 'd2'] },
    ]);
  });

  it('labelFrom 支持「已有 A/B 两排时接着编 C」（重建排时不撞名）', () => {
    const out = buildRowsFromClusters([cluster(['c1', 'c2'])], {
      nextId: () => 'rX',
      labelFrom: 2,
    });
    expect(out.rows[0].name).toBe('C 排');
  });

  it('rowMembers / componentsWithoutRow / rowIndexById 三处口径一致', () => {
    const comps = [
      rack('a1', 0, 0, 0, { rowId: 'r1' }),
      rack('a2', 600, 0, 0, { rowId: 'r1' }),
      rack('loose', 0, 600), // 候选但未成排
      rack('ac', 600, 600, 0, { attrs: { coolingKW: 50 } }), // 非候选，不进「未成排」
    ];
    const rows: RackRow[] = [{ id: 'r1', name: 'A 排' }];
    expect(rowMembers(comps, 'r1').map((c) => c.id)).toEqual(['a1', 'a2']);
    expect(componentsWithoutRow(comps).map((c) => c.id)).toEqual(['loose']);
    expect(rowIndexById(rows).get('r1')).toBe(0);
    expect(rowIndexById(rows).has('nope')).toBe(false);
  });
});

describe('Document 的排方法（与房间同一套范式）', () => {
  const makeDoc = () => {
    const doc = new Document(createEmptyProject());
    doc.addComponent(rack('c1', 0, 0));
    doc.addComponent(rack('c2', 600, 0));
    return doc;
  };

  it('addRow：重名自动编号 A 排 → A 排-2（与组件 / 房间一致）', () => {
    const doc = makeDoc();
    expect(doc.addRow({ id: 'r1', name: 'A 排' }).name).toBe('A 排');
    expect(doc.addRow({ id: 'r2', name: 'A 排' }).name).toBe('A 排-2');
    expect(doc.getRow('r2')?.name).toBe('A 排-2');
  });

  it('updateRow：roomId 用 in 判定，显式传 undefined 能清空（撤销「移出房间」要用）', () => {
    const doc = makeDoc();
    doc.addRow({ id: 'r1', name: 'A 排', roomId: 'room-a' });
    doc.updateRow('r1', { roomId: undefined });
    expect(doc.getRow('r1')?.roomId).toBeUndefined();
  });

  it('removeRow：不级联删组件，但成员 rowId 一并摘掉（不留悬空引用）', () => {
    const doc = makeDoc();
    doc.addRow({ id: 'r1', name: 'A 排' });
    doc.setMembersRow(['c1', 'c2'], 'r1');
    doc.removeRow('r1');
    expect(doc.project.components).toHaveLength(2); // 组件保留
    expect(doc.getComponent('c1')?.rowId).toBeUndefined();
    expect(doc.getComponent('c2')?.rowId).toBeUndefined();
  });

  it('setMembersRow：整批只发一条通知、返回实际变更数、重复赋值不再置脏', () => {
    const doc = makeDoc();
    doc.addRow({ id: 'r1', name: 'A 排' });
    const changes: { type: string; ids: string[] }[] = [];
    doc.subscribe((_d, ch) => changes.push({ type: ch.type, ids: ch.componentIds }));
    expect(doc.setMembersRow(['c1', 'c2'], 'r1')).toBe(2);
    expect(changes).toEqual([{ type: 'updated', ids: ['c1', 'c2'] }]); // 一条，不是两条
    changes.length = 0;
    expect(doc.setMembersRow(['c1', 'c2'], 'r1')).toBe(0); // 全部未变
    expect(changes).toEqual([]);
    expect(doc.setMembersRow(['c1'], null)).toBe(1);
    expect(doc.getComponent('c1')?.rowId).toBeUndefined();
  });

  it('DocChange：排的增删改一律带 rowIds（渲染层与统计层的增量依据）', () => {
    const doc = makeDoc();
    const seen: (string[] | undefined)[] = [];
    doc.subscribe((_d, ch) => seen.push(ch.rowIds));
    doc.addRow({ id: 'r1', name: 'A 排' });
    doc.updateRow('r1', { name: 'B 排' });
    doc.removeRow('r1');
    expect(seen.slice(0, 3)).toEqual([['r1'], ['r1'], ['r1']]);
  });
});

describe('排命令（FR-M08：一次操作 = 单条撤销记录）', () => {
  const makeDoc = () => {
    const doc = new Document(createEmptyProject());
    doc.addComponent(rack('c1', 0, 0));
    doc.addComponent(rack('c2', 600, 0));
    return doc;
  };

  it('AddRowCommand：建排 + 归组成员合成一条历史，撤销后两者同时回退', () => {
    const doc = makeDoc();
    doc.execute(new AddRowCommand({ id: 'r1', name: 'A 排' }, ['c1', 'c2']));
    expect(doc.project.rows).toHaveLength(1);
    expect(doc.getComponent('c1')?.rowId).toBe('r1');
    expect(doc.history).toHaveLength(1);
    expect(doc.history[0].name).toBe('创建排「A 排」');
    doc.undo();
    expect(doc.project.rows).toHaveLength(0);
    expect(doc.getComponent('c1')?.rowId).toBeUndefined();
    expect(doc.getComponent('c2')?.rowId).toBeUndefined();
  });

  it('RemoveRowCommand：撤销能同时还原排实体与成员归属', () => {
    const doc = makeDoc();
    doc.execute(new AddRowCommand({ id: 'r1', name: 'A 排' }, ['c1', 'c2']));
    doc.execute(new RemoveRowCommand('r1'));
    expect(doc.project.rows).toHaveLength(0);
    expect(doc.getComponent('c1')?.rowId).toBeUndefined();
    doc.undo();
    expect(doc.getRow('r1')?.name).toBe('A 排');
    expect(doc.getComponent('c1')?.rowId).toBe('r1');
    expect(doc.getComponent('c2')?.rowId).toBe('r1');
  });

  it('UpdateRowCommand：改名与换房可撤销；撤销「移出房间」能写回原 roomId', () => {
    const doc = makeDoc();
    doc.addRow({ id: 'r1', name: 'A 排', roomId: 'room-a' });
    doc.execute(new UpdateRowCommand('r1', { name: '冷通道 A', roomId: undefined }));
    expect(doc.getRow('r1')?.name).toBe('冷通道 A');
    expect(doc.getRow('r1')?.roomId).toBeUndefined();
    doc.undo();
    expect(doc.getRow('r1')?.roomId).toBe('room-a');
    expect(doc.getRow('r1')?.name).toBe('A 排');
  });

  it('重做（redo）后成员归属再次生效，两向对称', () => {
    const doc = makeDoc();
    doc.execute(new AddRowCommand({ id: 'r1', name: 'A 排' }, ['c1']));
    doc.undo();
    doc.redo();
    expect(doc.getComponent('c1')?.rowId).toBe('r1');
    expect(doc.project.rows).toHaveLength(1);
  });
});
