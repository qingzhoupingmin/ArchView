/**
 * pickComponentIds 拾取核心回归（修「视口左键点击模型没反应、拖不动」，产品文档 v0.14）：
 * T2.10e 层级重构（group > holder > mesh）后，拾取目标被改成 holder 容器（自身无几何体），
 * 而 `intersectObjects(targets, false)` 的 recursive 仍是 false——`Group.raycast` 是空实现，
 * 射线永不命中 → 3D 左键选择 / 拖组件直接移动、2D 左键选拖、双击聚焦、右键详情菜单全失效。
 * 零 DOM 依赖：真实 three 场景片段 + Raycaster，node 环境直接跑（根 vitest 的 include 已覆盖 renderer 包）。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { pickComponentIds } from './viewport/picking';
import type { PickEntry } from './viewport/types';

/** 构造标准条目（group > holder > mesh，与 buildEntry 同一层级）；mesh 携带 componentId */
function makeEntry(id: string, x = 0, y = 300, z = 0): {
  entry: PickEntry;
  group: THREE.Group;
  holder: THREE.Group;
  mesh: THREE.Mesh;
} {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  const holder = new THREE.Group();
  group.add(holder);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(600, 600, 600));
  mesh.userData.componentId = id;
  holder.add(mesh);
  return {
    entry: { group, meshes: [mesh], box: new THREE.Box3(), boxDirty: true },
    group,
    holder,
    mesh,
  };
}

/** 平行 -Z 的射线：起点 (x, 300, z) —— 穿过 y=300 处 600³ 组件的中心 */
function rayAt(x: number, z: number): THREE.Raycaster {
  const r = new THREE.Raycaster();
  r.set(new THREE.Vector3(x, 300, z), new THREE.Vector3(0, 0, -1));
  return r;
}

describe('pickComponentIds（T2.10f 粗筛 + 精确求交）', () => {
  it('点中组件命中（回归：命中目标必须是具体 mesh，不能是 holder 容器）', () => {
    const { entry } = makeEntry('c1');
    expect(pickComponentIds(rayAt(0, 1000), [entry])).toEqual(['c1']);
  });

  it('点击空处返回空（粗筛：包围盒不被射线经过的组件不参与求交）', () => {
    const { entry } = makeEntry('c1');
    expect(pickComponentIds(rayAt(10000, 1000), [entry])).toEqual([]);
  });

  it('穿透顺序近 → 远；同组件多图元去重（T2.4 依赖该顺序）', () => {
    const front = makeEntry('front');
    const back = makeEntry('back', 0, 300, -2000);
    expect(pickComponentIds(rayAt(0, 1000), [front.entry, back.entry])).toEqual(['front', 'back']);

    // 多部件组件：两个图元同被命中 → 只报一个 ID
    const multi = makeEntry('multi');
    const extra = new THREE.Mesh(new THREE.BoxGeometry(400, 400, 400));
    extra.position.z = 400; // 第二个图元，同一射线也会穿过
    extra.userData.componentId = 'multi';
    multi.holder.add(extra);
    multi.entry.meshes.push(extra);
    expect(pickComponentIds(rayAt(0, 1000), [multi.entry])).toEqual(['multi']);
  });

  it('包围盒懒算 + 变换置脏（T2.10f）：置脏前信缓存、置脏后重算', () => {
    const { entry } = makeEntry('c1'); // 位于 (0,300,0)
    expect(pickComponentIds(rayAt(10000, 1000), [entry])).toEqual([]); // 包围盒已算，boxDirty=false
    // 移动组件但不置脏 → 仍用旧包围盒（粗筛漏掉）
    entry.group.position.set(10000, 300, 0);
    expect(pickComponentIds(rayAt(10000, 1000), [entry])).toEqual([]);
    // 置脏（applyTransform / 直接拖拽同一约定）→ 懒算重算后命中
    entry.boxDirty = true;
    expect(pickComponentIds(rayAt(10000, 1000), [entry])).toEqual(['c1']);
  });

  it('锁定 three 语义：recursive=false 不遍历 holder 子节点（本次回归的根因）', () => {
    const { group, holder, mesh } = makeEntry('c1');
    group.updateMatrixWorld(true);
    // 射线偏离面心：正对中心时恰穿过面的三角对角线，会被两个三角双命中（退化情形，
    // 生产由 pickComponentIds 的去重兜底）；偏 50mm 即单命中
    const r = rayAt(50, 1000);
    // 传空容器 Group：射线穿过也不命中
    expect(r.intersectObjects([holder], false)).toHaveLength(0);
    // 传具体 mesh：正常命中，且能取回 componentId
    expect(r.intersectObjects([mesh], false).map((h) => h.object.userData.componentId)).toEqual(['c1']);
  });
});
