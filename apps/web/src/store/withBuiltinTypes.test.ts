/**
 * 工程载入时的类型对齐（T2.11 / 开发计划 §4.2 S2.5 C 段配套）。
 * 这条链路是「素材精修到底能不能被看见」的总闸：P1 约定工程随存盘带上用到的类型，
 * 于是旧实现的「已有类型保留原样」会把内置素材钉死在存盘那一刻的灰盒几何上。
 */
import { describe, expect, it } from 'vitest';
import { createEmptyProject, type ComponentType, type Project } from '@archview/core';
import { componentTypes } from '@archview/component-lib';
import { withBuiltinTypes } from './useDocumentStore';

/** 内置库里的 42U 机柜（T2.11 精修后应为多部件 L2，非单盒） */
const builtinRack = componentTypes.find((t) => t.id === 'it-rack42')!;

/** 造一份「旧工程存盘的灰盒快照」 */
const staleRack = (): ComponentType => ({
  ...structuredClone(builtinRack),
  geometry: [
    {
      kind: 'box',
      size: [600, 2000, 1000],
      offset: { x: 0, y: 1000, z: 0 },
      color: '#CBC7D4',
    },
  ],
});

const projectWith = (types: ComponentType[]): Project => {
  const p = createEmptyProject();
  p.types = types;
  return p;
};

describe('withBuiltinTypes（T2.11 内置素材几何收口）', () => {
  it('旧工程存盘的灰盒快照 → 载入时被组件库精修几何覆盖', () => {
    const out = withBuiltinTypes(projectWith([staleRack()]));
    expect(out.types).toHaveLength(53); // 补齐全部内置类型（T2.9 行为不回归）
    const rack = out.types.find((t) => t.id === 'it-rack42')!;
    expect(rack.geometry.length).toBeGreaterThan(1);
    expect(rack.geometry.map((g) => g.name)).toContain('door');
  });

  it('用户自定义类型（ID 不在内置库）原样保留', () => {
    const custom: ComponentType = { ...staleRack(), id: 'my-box', name: '我的盒子' };
    const out = withBuiltinTypes(projectWith([custom]));
    const kept = out.types.find((t) => t.id === 'my-box')!;
    expect(kept.geometry).toHaveLength(1);
    expect(kept.name).toBe('我的盒子');
  });

  it('空 types（旧数据）→ 回退整库（FR-M01）', () => {
    expect(withBuiltinTypes(projectWith([])).types).toHaveLength(53);
  });

  it('纯函数：不改动传入工程', () => {
    const project = projectWith([staleRack()]);
    const before = project.types![0].geometry.length;
    withBuiltinTypes(project);
    expect(project.types).toHaveLength(1);
    expect(project.types![0].geometry.length).toBe(before);
  });
});
