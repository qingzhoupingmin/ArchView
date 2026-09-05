/**
 * 工程类型合并纯函数单测（T2.11 / 产品文档 §6.5）：
 * 核心锁死三件事——① ID 命中内置库时**几何以库为准**（否则素材精修对旧工程与黄金样例失效）；
 * ② ID 不在内置库的自定义类型必须原样保留（§12 社区轨扩展点）；③ 顺序稳定且不改动入参。
 */
import { describe, expect, it } from 'vitest';
import type { Component, ComponentType } from './types';
import {
  alignBuiltinTypes,
  migrateProject,
  refreshBuiltinTypes,
  type LegacyProject,
} from './project';

/** 造一个类型；boxColor 用来区分「灰盒快照」与「精修后的库版本」 */
const type = (id: string, primCount: number): ComponentType => ({
  id,
  name: id,
  category: 'it',
  defaultSize: { w: 600, d: 1000, h: 2000 },
  geometry: Array.from({ length: primCount }, (_, i) => ({
    kind: 'box' as const,
    size: [600, 2000, 1000],
    offset: { x: 0, y: 1000, z: i },
    color: '#CBC7D4',
    name: i === 0 ? 'body' : `p${i}`,
    material: 'metal' as const,
  })),
  defaultAttrs: {},
});

describe('alignBuiltinTypes（T2.11 内置素材几何收口）', () => {
  it('ID 命中内置库 → 用库几何覆盖存盘的旧灰盒', () => {
    const stale = [type('it-rack42', 1)]; // 旧工程：单盒
    const builtin = [type('it-rack42', 7)]; // 组件库：精修后 7 图元
    const out = alignBuiltinTypes(stale, builtin);
    expect(out).toHaveLength(1);
    expect(out[0].geometry).toHaveLength(7);
  });

  it('ID 不在内置库 → 视为用户自定义类型，原样保留', () => {
    const custom = type('my-widget', 3);
    const out = alignBuiltinTypes([custom], [type('it-rack42', 7)]);
    expect(out.map((t) => t.id)).toEqual(['my-widget', 'it-rack42']);
    expect(out[0].geometry).toHaveLength(3);
  });

  it('工程 types 为空 / undefined → 回退全量内置库（旧数据兜底）', () => {
    const builtin = [type('it-rack42', 7), type('ac-precision', 5)];
    expect(alignBuiltinTypes(undefined, builtin).map((t) => t.id)).toEqual([
      'it-rack42',
      'ac-precision',
    ]);
    expect(alignBuiltinTypes([], builtin)).toHaveLength(2);
  });

  it('顺序：保留工程原有次序，库中新增的类型追加在后', () => {
    const builtin = [type('a', 2), type('b', 2), type('c', 2)];
    const out = alignBuiltinTypes([builtin[2], builtin[0]], builtin);
    expect(out.map((t) => t.id)).toEqual(['c', 'a', 'b']);
  });

  it('存盘重复 ID 去重（否则组件库面板出现同名双份卡片）', () => {
    const out = alignBuiltinTypes([type('it-rack42', 1), type('it-rack42', 1)], [
      type('it-rack42', 7),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].geometry).toHaveLength(7);
  });

  it('纯函数：不改动传入数组与元素', () => {
    const stale = [type('it-rack42', 1)];
    const snapshot = JSON.stringify(stale);
    alignBuiltinTypes(stale, [type('it-rack42', 7)]);
    expect(JSON.stringify(stale)).toBe(snapshot);
  });
});

describe('refreshBuiltinTypes（T2.11 黄金样例的轻量口径）', () => {
  it('只刷新命中的类型，不追加缺失的内置类型', () => {
    const out = refreshBuiltinTypes([type('it-rack42', 1)], [type('it-rack42', 7), type('a', 2)]);
    expect(out.map((t) => t.id)).toEqual(['it-rack42']);
    expect(out[0].geometry).toHaveLength(7);
  });

  it('自定义类型保留、顺序不变（样例只存用到的 4 型，不能被撑成整库）', () => {
    const out = refreshBuiltinTypes([type('my-widget', 3), type('it-rack42', 1)], [
      type('it-rack42', 7),
    ]);
    expect(out.map((t) => t.id)).toEqual(['my-widget', 'it-rack42']);
    expect(out[0].geometry).toHaveLength(3);
  });
});

/**
 * migrateProject（T3.1 / 产品文档 §8.2-12）：`Project.rows` 是必填字段，
 * 而线上与 IndexedDB 缓冲里的旧工程都没有它——本组用例就是「不升 schemaVersion」
 * 这个决策（D1）的兑现凭证：任何一条挂了，就说明旧工程会打不开或统计会算错账。
 */
function legacy(over: Partial<LegacyProject> = {}): LegacyProject {
  return {
    id: 'p1',
    name: '旧工程',
    schemaVersion: 1,
    unit: 'mm',
    grid: { step: 600, snap: true },
    rooms: [],
    zones: [],
    types: [],
    components: [],
    visibility: 'private',
    meta: { createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
    ...over,
  };
}

const rack = (id: string, rowId?: string): Component => ({
  id,
  typeId: 'it-rack42',
  name: id,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
  size: { w: 600, d: 1000, h: 2000 },
  attrs: {},
  uAssignments: [],
  tags: [],
  note: '',
  visible: true,
  ...(rowId ? { rowId } : {}),
});

describe('migrateProject（T3.1 载入边界收口）', () => {
  it('旧工程缺 rows → 补空数组，其余字段原样不动', () => {
    const out = migrateProject(legacy({ components: [rack('c1')] }));
    expect(out.rows).toEqual([]);
    expect(out.components).toHaveLength(1);
    expect(out.grid).toEqual({ step: 600, snap: true });
  });

  it('不升 schemaVersion（D1 决策：加法式变更，升版触发条件是引入 gltf 引用）', () => {
    const out = migrateProject(legacy({ schemaVersion: 1 }));
    expect(out.schemaVersion).toBe(1);
  });

  it('残缺 dataJson（服务端只存过 { schemaVersion, secret } 这类对象）→ components 兜空数组不崩', () => {
    const out = migrateProject({
      schemaVersion: 1,
      secret: 'A 的机房布局',
    } as unknown as LegacyProject);
    expect(out.rows).toEqual([]);
    expect(out.components).toEqual([]);
  });

  it('脏 rows 清洗：非对象 / 无 id / 空 id / 重复 id 全丢，多余字段剥掉', () => {
    const out = migrateProject({
      rows: [
        { id: 'r1', name: 'A 排' },
        { id: 'r1', name: '重复的 A 排' },
        { id: '', name: '空 id' },
        { name: '没 id' },
        'not-an-object',
        null,
        { id: 'r2', name: 'B 排', roomId: 'room-1', hacker: '多余字段' },
      ],
    } as unknown as LegacyProject);
    expect(out.rows).toEqual([
      { id: 'r1', name: 'A 排' },
      { id: 'r2', name: 'B 排', roomId: 'room-1' },
    ]);
  });

  it('成员 rowId 悬空 → 摘掉；有效 rowId → 保留（否则同一台柜会被算两次）', () => {
    const out = migrateProject(
      legacy({
        rows: [{ id: 'r1', name: 'A 排' }],
        components: [rack('keep', 'r1'), rack('drop', 'r-deleted'), rack('none')],
      }),
    );
    expect(out.components.find((c) => c.id === 'keep')?.rowId).toBe('r1');
    expect(out.components.find((c) => c.id === 'drop')?.rowId).toBeUndefined();
    expect('rowId' in (out.components.find((c) => c.id === 'drop') ?? {})).toBe(false);
    expect(out.components.find((c) => c.id === 'none')?.rowId).toBeUndefined();
  });

  it('无需变更时复用原 components 引用（1000 组件工程载入不多跑一遍拷贝）', () => {
    const comps = [rack('c1', 'r1')];
    const out = migrateProject(legacy({ rows: [{ id: 'r1', name: 'A 排' }], components: comps }));
    expect(out.components).toBe(comps);
  });

  it('幂等：迁移两次与一次结果完全相同', () => {
    const dirty = legacy({
      rows: [{ id: 'r1', name: 'A 排' }, { id: 'r1', name: 'dup' }] as never,
      components: [rack('c1', 'gone')],
    });
    const once = migrateProject(dirty);
    expect(migrateProject(once)).toEqual(once);
  });

  it('纯函数：不改动入参对象与其 components 数组', () => {
    const comps = [rack('c1', 'gone')];
    const input = legacy({ components: comps });
    const snapshot = JSON.stringify(input);
    migrateProject(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(comps[0].rowId).toBe('gone');
  });
});
