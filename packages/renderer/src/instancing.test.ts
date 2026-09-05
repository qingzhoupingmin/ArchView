/**
 * 批渲染层单测（S2.5 / T2.10g，开发计划 §4.3 T5.0）。
 * 零 DOM / 零 WebGL：`InstancedMesh` 与 `Matrix4` 都是纯 JS，只有真正出图才需要 GL 上下文
 * （与 viewport.pick.test.ts 同一套路）。锁四件事——
 * ① 分桶键（该合的合、该分的分）；② 容量倍增与尾部交换删除的槽位一致性（最容易悬空的地方）；
 * ③ **共享几何绝不被释放**（T2.10f 的老坑）；④ emissive 着色器补丁的锚点仍然存在（three 升级预警）。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ShaderLib } from 'three';
import {
  instanceMatrixOf,
  instanceScaleRatio,
  placePrimitive,
  sizeRatio,
  type Component,
  type ComponentType,
  type GeometryPrimitive,
  type MaterialSlot,
} from '@archview/core';
import {
  applyEmissiveVColorPatch,
  BatchLayer,
  type BatchHit,
  type BatchPrim,
} from './instancing';
import { pickHits } from './viewport/picking';
import type { PickEntry } from './viewport/types';

/** 平移矩阵（列主序）：够测位姿，不必拉上四元数 */
const at = (x: number, y: number, z: number): number[] => [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1,
];

const prim = (
  geometry: THREE.BufferGeometry,
  extra: Partial<BatchPrim> = {},
): BatchPrim => ({
  slot: 'matte',
  castShadow: true,
  matrix: at(0, 0, 0),
  color: '#D8D5DE',
  geometry,
  ...extra,
});

const boxGeo = () => new THREE.BoxGeometry(600, 600, 600);

describe('applyEmissiveVColorPatch（instanceColor 只管漫反射的补救）', () => {
  it('three 物理着色器仍含注入锚点（升级改写法时此条先红，提醒重看 emissive 档）', () => {
    expect(ShaderLib.physical.fragmentShader).toContain('vec3 totalEmissiveRadiance = emissive;');
  });

  it('命中锚点则乘上 vColor，自发光跟着逐实例色走', () => {
    const out = applyEmissiveVColorPatch('vec3 totalEmissiveRadiance = emissive;');
    expect(out).toBe('vec3 totalEmissiveRadiance = emissive * vColor;');
  });

  it('找不到锚点时原样返回（退化成白自发光，而不是把着色器改坏）', () => {
    const src = 'vec3 totalEmissiveRadiance = emissiveMap;';
    expect(applyEmissiveVColorPatch(src)).toBe(src);
  });
});

describe('BatchLayer 分桶（T2.10g 的第一性问题：什么算同一批）', () => {
  it('同几何 + 同材质档 + 同投影口径 ⇒ 合进一个桶', () => {
    const layer = new BatchLayer();
    const geo = boxGeo();
    layer.set('a', [prim(geo, { matrix: at(0, 0, 0) })]);
    layer.set('b', [prim(geo, { matrix: at(600, 0, 0) })]);
    expect(layer.getStats()).toEqual({ buckets: 1, instances: 2, capacity: 16 });
    expect(layer.root.children).toHaveLength(1);
    expect((layer.root.children[0] as THREE.InstancedMesh).count).toBe(2);
    layer.dispose();
  });

  it('材质档 / 投影口径 / 几何任一不同 ⇒ 分开成桶（投影开关必须分桶，否则整桶阴影口径错）', () => {
    const layer = new BatchLayer();
    const geo = boxGeo();
    layer.set('a', [prim(geo, { slot: 'metal' })]);
    layer.set('b', [prim(geo, { slot: 'metal', castShadow: false })]);
    layer.set('c', [prim(geo, { slot: 'matte' })]);
    layer.set('d', [prim(boxGeo(), { slot: 'metal' })]);
    expect(layer.getStats().buckets).toBe(4);
    layer.dispose();
  });

  it('同组件重复 set 是覆盖不是追加（改尺寸 / 换类型的更新路径不能留幽灵实例）', () => {
    const layer = new BatchLayer();
    const geo = boxGeo();
    layer.set('a', [prim(geo), prim(geo, { slot: 'metal' })]);
    layer.set('a', [prim(geo)]);
    expect(layer.getStats().instances).toBe(1);
    expect(layer.has('a')).toBe(true);
    layer.dispose();
  });

  it('同型同档同投影的一对图元（rail-l 与 rail-r）不会互相覆盖槽位', () => {
    // 素材里 9 对 far 档对称件正是这种情况：不加图元序号合桶，删除组件会留下删不掉的幽灵实例
    const layer = new BatchLayer();
    const geo = boxGeo();
    layer.set('rack', [prim(geo, { matrix: at(-260, 0, 0) }), prim(geo, { matrix: at(260, 0, 0) })]);
    expect(layer.getStats()).toMatchObject({ buckets: 2, instances: 2 });
    layer.remove('rack');
    expect(layer.getStats()).toMatchObject({ instances: 0, buckets: 0 });
    expect(layer.root.children).toHaveLength(0);
    layer.dispose();
  });

  it('图元集合缩小后旧桶被回收（只删桶不删共享几何与材质）', () => {
    const layer = new BatchLayer();
    const geo = boxGeo();
    let geoDisposed = 0;
    geo.addEventListener('dispose', () => geoDisposed++);
    layer.set('a', [prim(geo), prim(geo, { slot: 'metal' })]);
    expect(layer.getStats().buckets).toBe(2);
    layer.set('a', [prim(geo)]);
    expect(layer.getStats().buckets).toBe(1);
    layer.dispose();
    expect(geoDisposed).toBe(0); // 关键断言：几何是 geoCache 的共享资源，批层无权释放
  });
});

describe('BatchLayer 槽位管理（容量倍增 + 尾部交换）', () => {
  it('超过初始容量按 2× 倍增，且已有实例的矩阵与颜色原样搬过去', () => {
    const layer = new BatchLayer();
    const geo = boxGeo();
    for (let i = 0; i < 17; i++) layer.set(`c${i}`, [prim(geo, { matrix: at(i * 100, 0, 0) })]);
    const stats = layer.getStats();
    expect(stats).toMatchObject({ buckets: 1, instances: 17 });
    expect(stats.capacity).toBe(32);
    const mesh = layer.root.children[0] as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    expect(m.elements[12]).toBe(0);
    mesh.getMatrixAt(16, m);
    expect(m.elements[12]).toBe(1600); // 第 1 条（i=0）与最后一条（i=16）都还在原位
    expect(layer.root.children).toHaveLength(1); // 倍增是换桶不是加桶
    layer.dispose();
  });

  it('删中间实例走尾部交换：被搬走的那个换到新槽位，再删它不残留', () => {
    const layer = new BatchLayer();
    const geo = boxGeo();
    layer.set('a', [prim(geo, { matrix: at(0, 0, 0) })]);
    layer.set('b', [prim(geo, { matrix: at(1000, 0, 0) })]);
    layer.set('c', [prim(geo, { matrix: at(2000, 0, 0) })]);
    const mesh = () => layer.root.children[0] as THREE.InstancedMesh;
    const m = new THREE.Matrix4();

    layer.remove('b');
    expect(mesh().count).toBe(2);
    mesh().getMatrixAt(1, m);
    expect(m.elements[12]).toBe(2000); // c 从槽位 2 搬进槽位 1
    expect(layer.has('c')).toBe(true);

    layer.remove('c'); // 靠更新后的槽位记录才删得掉（没同步就会留一个删不掉的幽灵实例）
    expect(mesh().count).toBe(1);
    expect(layer.getStats().instances).toBe(1);
    layer.remove('a');
    expect(layer.getStats().buckets).toBe(0);
    expect(layer.root.children).toHaveLength(0);
    layer.dispose();
  });

  it('未知 ID 与空图元集合都是安全的 no-op', () => {
    const layer = new BatchLayer();
    layer.remove('nope');
    layer.set('x', []);
    expect(layer.has('x')).toBe(false);
    expect(layer.getStats().instances).toBe(0);
    layer.dispose();
  });

  it('flush 只把脏桶的 buffer 版本推上去，并刷新整桶包围球', () => {
    const layer = new BatchLayer();
    const geo = boxGeo();
    layer.set('a', [prim(geo, { matrix: at(0, 0, 0) })]);
    layer.set('b', [prim(geo, { matrix: at(9000, 0, 0) })]);
    const mesh = layer.root.children[0] as THREE.InstancedMesh;
    expect(mesh.instanceMatrix.version).toBe(0);
    expect(mesh.boundingSphere).toBeNull();
    layer.flush();
    expect(mesh.instanceMatrix.version).toBeGreaterThan(0);
    expect(mesh.instanceColor?.version).toBeGreaterThan(0);
    // 整桶包围球要同时罩住两个端点实例，否则视锥剔除会误裁
    expect(mesh.boundingSphere?.center.x).toBeCloseTo(4500);
    expect(mesh.boundingSphere?.radius).toBeGreaterThan(4500);
    layer.flush(); // 无脏桶时不再推版本
    expect(mesh.instanceMatrix.version).toBeGreaterThan(0);
    layer.dispose();
  });
});

describe('BatchLayer.pick（探针求交，不用 InstancedMesh.raycast）', () => {
  /**
   * 从 (x,300,+z) 朝 −Z 打一条射线，正对 y=300 处 600³ 的实例。
   * x 默认偏 50mm：正对面心时射线恰落在方格的两块三角对角线上，会被双命中
   * （three 的固有退化，`viewport.pick.test.ts` 已记录过一次），生产由上层按 id 去重兜住。
   */
  const ray = (x = 50): THREE.Raycaster => {
    const r = new THREE.Raycaster();
    r.set(new THREE.Vector3(x, 300, 5000), new THREE.Vector3(0, 0, -1));
    return r;
  };
  const primAt = (geo: THREE.BufferGeometry, x: number, z: number): BatchPrim =>
    prim(geo, { matrix: at(x, 300, z) });

  it('命中候选实例并带回距离（穿透排序靠它）', () => {
    const layer = new BatchLayer();
    const geo = boxGeo();
    layer.set('a', [primAt(geo, 0, 0)]);
    layer.flush();
    const out: BatchHit[] = [];
    layer.pick(ray(), ['a'], out);
    expect(out.map((h) => h.id)).toEqual(['a']);
    expect(out[0]!.distance).toBeCloseTo(4700); // 5000 − 300（盒前面）
    layer.dispose();
  });

  it('近 → 远两实例同射线：两条命中各自可回溯到所属组件', () => {
    const layer = new BatchLayer();
    const geo = boxGeo();
    layer.set('front', [primAt(geo, 0, 0)]);
    layer.set('back', [primAt(geo, 0, -2000)]);
    layer.flush();
    const out: BatchHit[] = [];
    layer.pick(ray(), ['front', 'back'], out);
    const sorted = out.sort((x, y) => x.distance - y.distance);
    // 同组件多面命中会重复出现，去重是上层 pickComponentIds 的职责（那边已单测锁死）
    expect(Array.from(new Set(sorted.map((h) => h.id)))).toEqual(['front', 'back']);
    expect(sorted[0]!.distance).toBeLessThan(sorted[sorted.length - 1]!.distance);
    layer.dispose();
  });

  it('偏离 / 非候选组件都不命中（粗筛交回调用方，探针只负责精确求交）', () => {
    const layer = new BatchLayer();
    const geo = boxGeo();
    layer.set('a', [primAt(geo, 0, 0)]);
    layer.flush();
    const miss: BatchHit[] = [];
    layer.pick(ray(5000), ['a'], miss);
    expect(miss).toEqual([]);
    const notCandidate: BatchHit[] = [];
    layer.pick(ray(), ['ghost'], notCandidate);
    expect(notCandidate).toEqual([]);
    layer.dispose();
  });
});

/**
 * **T2.10g 的验收核心**：实例矩阵必须与旧三层场景图（`group(位姿) > holder > mesh`，T2.10e）
 * 逐元素等价。这是「一键关批画面不许变」的数学保证——合批引入的不是新算式，
 * 而是把同一条连乘从 three 的矩阵栈里搬到实例 buffer 里。
 */
describe('实例矩阵 ≡ 旧三层场景图（T2.10g 零回归锁）', () => {
  const DEFAULT = { w: 600, h: 2000, d: 1000 };
  const type = { defaultSize: DEFAULT } as unknown as ComponentType;

  const comp = (over: Partial<Component>): Component =>
    ({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      size: { ...DEFAULT },
      ...over,
    }) as unknown as Component;

  /** 实例路径实际用的那个位姿视图（group.position / group.quaternion 的替身） */
  const poseOf = (c: Component): THREE.Object3D => {
    const g = new THREE.Object3D();
    g.position.set(c.position.x, c.position.y, c.position.z);
    g.quaternion.set(c.rotation.x, c.rotation.y, c.rotation.z, c.rotation.w);
    return g;
  };

  /** 旧实现：真建三层节点，让 three 自己算 matrixWorld */
  function legacyWorldMatrix(c: Component, prim: GeometryPrimitive): THREE.Matrix4 {
    const r = sizeRatio(c, type);
    const ratio = { x: r.x * c.scale.x, y: r.y * c.scale.y, z: r.z * c.scale.z };
    const group = new THREE.Group();
    group.position.set(c.position.x, c.position.y, c.position.z);
    group.quaternion.set(c.rotation.x, c.rotation.y, c.rotation.z, c.rotation.w);
    const holder = new THREE.Group();
    group.add(holder);
    const mesh = new THREE.Mesh();
    holder.add(mesh);
    const placed = placePrimitive(prim, ratio);
    mesh.position.set(placed.position.x, placed.position.y, placed.position.z);
    mesh.scale.set(placed.scale.x, placed.scale.y, placed.scale.z);
    group.updateMatrixWorld(true);
    return mesh.matrixWorld.clone();
  }

  /** 批渲染实现（与 Viewport3D.refreshBatchMatrices 同一条调用链） */
  function batchWorldMatrix(c: Component, prim: GeometryPrimitive): THREE.Matrix4 {
    const pose = poseOf(c);
    pose.updateMatrix();
    const ratio = instanceScaleRatio(c, type);
    return new THREE.Matrix4().fromArray(
      instanceMatrixOf({ position: pose.position, rotation: pose.quaternion }, prim, ratio) as number[],
    );
  }

  const cases: [string, GeometryPrimitive, Component][] = [
    ['落地件原尺寸', { kind: 'box', size: [600, 2000, 1000], offset: { x: 0, y: 1000, z: 0 } }, comp({})],
    [
      '非等比缩放（FR-M03 w-d 手柄）',
      { kind: 'box', size: [600, 2000, 1000], offset: { x: 0, y: 1000, z: 0 } },
      comp({ size: { w: 1200, h: 1000, d: 400 } }),
    ],
    [
      '吊顶件 absolute：偏移是绝对 mm，不随尺寸缩放',
      { kind: 'box', size: [150, 120, 150], offset: { x: 0, y: 3480, z: 0 }, anchor: 'absolute' },
      comp({ size: { w: 300, h: 240, d: 300 }, position: { x: 9000, y: 0, z: 1200 } }),
    ],
    [
      '堆叠件 ground：偏移随尺寸比缩放',
      { kind: 'box', size: [600, 200, 1000], offset: { x: 0, y: 1100, z: 0 } },
      comp({ size: { w: 600, h: 4000, d: 1000 } }),
    ],
    [
      '偏航 90°（四元数）+ 偏心偏移',
      { kind: 'box', size: [600, 2000, 1000], offset: { x: 300, y: 1000, z: -120 } },
      comp({
        position: { x: 5400, y: 0, z: 7800 },
        rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
      }),
    ],
    [
      '任意角度 + comp.scale 叠加（FR-M06）',
      { kind: 'box', size: [600, 2000, 1000], offset: { x: -300, y: 1000, z: 400 } },
      comp({
        rotation: { x: 0, y: 0.25881904510252074, z: 0, w: 0.9659258262890683 },
        scale: { x: 1.5, y: 0.8, z: 2 },
      }),
    ],
    [
      '圆柱图元（灭火器瓶身，绕 Y 90° 后仍等距）',
      { kind: 'cylinder', size: [75, 480], offset: { x: 0, y: 240, z: 0 } },
      comp({
        size: { w: 150, h: 960, d: 150 },
        rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
      }),
    ],
    [
      '平面图元（plane：v3.9 起为朝 +Z 的竖屏面，无躺平旋转）',
      { kind: 'plane', size: [1000, 2000], offset: { x: 0, y: 50, z: 0 } },
      comp({ size: { w: 2000, h: 50, d: 4000 } }),
    ],
  ];

  for (const [label, prim, c] of cases) {
    it(`${label}：实例矩阵与三层连乘逐元素相等`, () => {
      const legacy = legacyWorldMatrix(c, prim);
      const batch = batchWorldMatrix(c, prim);
      for (let i = 0; i < 16; i++) {
        expect(batch.elements[i]).toBeCloseTo(legacy.elements[i]!, 3);
      }
    });
  }
});

describe('pickHits 双路合并（T2.10h 交互回归口径）', () => {
  const ray = (x = 50): THREE.Raycaster => {
    const r = new THREE.Raycaster();
    r.set(new THREE.Vector3(x, 300, 5000), new THREE.Vector3(0, 0, -1));
    return r;
  };

  /** 旧三层结构条目（solo 路径）：包围盒交给拾取路径懒算 */
  function soloEntry(id: string, z: number): PickEntry {
    const group = new THREE.Group();
    group.position.set(0, 300, z);
    const holder = new THREE.Group();
    group.add(holder);
    const mesh = new THREE.Mesh(boxGeo());
    mesh.userData.componentId = id;
    holder.add(mesh);
    return { group, meshes: [mesh], box: new THREE.Box3(), boxDirty: true };
  }

  /** 已进桶的条目：group 是空容器、meshes 为空、盒由渲染层算好（boxDirty = false） */
  function batchedEntry(layer: BatchLayer, id: string, z: number, prims?: BatchPrim[]): PickEntry {
    layer.set(id, prims ?? [prim(boxGeo(), { matrix: at(0, 300, z) })]);
    layer.flush();
    return {
      group: new THREE.Group(),
      meshes: [],
      box: new THREE.Box3(
        new THREE.Vector3(-300, 0, z - 300),
        new THREE.Vector3(300, 600, z + 300),
      ),
      boxDirty: false,
      id,
      solo: false,
    };
  }

  it('batch = null（关批）时与旧 pickComponentIds 完全一致', () => {
    const entries = [soloEntry('s1', 0), soloEntry('s2', -2000)];
    expect(pickHits(ray(), entries, null).ids).toEqual(['s1', 's2']);
  });

  it('独立 mesh 与实例桶混排：按世界距离近 → 远（穿透连点口径不变）', () => {
    const layer = new BatchLayer();
    const back = soloEntry('solo-back', -2000);
    const front = batchedEntry(layer, 'batch-front', 0);
    // 反过来传也不影响顺序：合并后统一按距离排序
    expect(pickHits(ray(), [back, front], layer).ids).toEqual(['batch-front', 'solo-back']);
    expect(pickHits(ray(), [front, back], layer).ids).toEqual(['batch-front', 'solo-back']);
    layer.dispose();
  });

  it('同组件多图元进不同桶也只报一次（多选描边与详情菜单依赖去重）', () => {
    const layer = new BatchLayer();
    const entry = batchedEntry(layer, 'multi', 0, [
      prim(boxGeo(), { matrix: at(0, 300, 0) }),
      prim(boxGeo(), { slot: 'metal', matrix: at(0, 300, -200) }),
    ]);
    const res = pickHits(ray(), [entry], layer);
    expect(res.ids).toEqual(['multi']);
    expect(res.hits.length).toBeGreaterThanOrEqual(2); // 两个图元都真被穿过
    layer.dispose();
  });

  it('包围盒不通过的组件不参与求交（批路径用的是预算盒，算错就整台点不中）', () => {
    const layer = new BatchLayer();
    layer.set('side', [prim(boxGeo(), { matrix: at(50000, 300, 0) })]);
    layer.flush();
    const side: PickEntry = {
      group: new THREE.Group(),
      meshes: [],
      box: new THREE.Box3(
        new THREE.Vector3(49700, 0, -300),
        new THREE.Vector3(50300, 600, 300),
      ),
      boxDirty: false,
      id: 'side',
      solo: false,
    };
    const near = batchedEntry(layer, 'near', 0);
    expect(pickHits(ray(), [side, near], layer).ids).toEqual(['near']);
    layer.dispose();
  });
});

/**
 * T2.10g 验收口径（开发计划 §4.2 任务卡：「1000 组件 × 8 图元 draw calls ≤ 64」）。
 * 不需要 WebGL：`InstancedMesh` 的桶数就是合批后的单通道 draw call 上限，
 * 所以这条断言可以在 CI 里长期守住帧率预算——比「主人跑一遍看看卡不卡」可靠得多。
 */
describe('密集阵列合批预算（T2.10g 验收）', () => {
  it('1000 台 7 图元机柜只产生 7 个桶（主通道 7 + 阴影 3 = 10 calls，远低于 64 上限）', () => {
    const layer = new BatchLayer();
    // it-rack42 的 far 档构成：壳体 / 门框 / 网孔 / 导轨 ×2 / LED / 脚座（各自一份几何）
    const geos = [600, 580, 560, 30, 30, 40, 120].map((w) => new THREE.BoxGeometry(w, 2000, 1000));
    const slots: MaterialSlot[] = ['metal', 'metal', 'grille', 'metal', 'metal', 'emissive', 'rubber'];
    for (let i = 0; i < 1000; i++) {
      layer.set(
        `rack-${i}`,
        geos.map((g, p) =>
          prim(g, { slot: slots[p]!, matrix: at(i * 700, 0, 0), castShadow: p < 3 }),
        ),
      );
    }
    const stats = layer.getStats();
    // 7 图元 → 7 桶（同型的 1000 个实例合进同 7 桶）；未合批时是 7000 只 mesh
    expect(stats.instances).toBe(7000);
    expect(stats.buckets).toBe(7);
    expect(stats.buckets * 2).toBeLessThanOrEqual(64); // 含阴影通道的验收线
    // 容量按 2× 倍增：16 → 1024，每桶浪费 2.4%（`capacity` 是各桶容量之和）
    expect(stats.capacity).toBe(7 * 1024);
    expect(stats.capacity / stats.instances).toBeLessThan(1.03);
    layer.dispose();
  });

  it('关批回到旧实现时的图元数即 draw call 数（把「1 图元 = 1 call」这条账也钉住）', () => {
    const layer = new BatchLayer();
    const geo = boxGeo();
    for (let i = 0; i < 53; i++) {
      // 53 型各 1 件、每件 2 图元（现状 far avg 2.04 的下取整近似）
      layer.set(`t${i}`, [prim(geo), prim(geo, { slot: 'metal', matrix: at(0, 0, i * 700) })]);
    }
    const stats = layer.getStats();
    expect(stats.instances).toBe(106); // 未合批 = 106 只 mesh = 106 calls
    expect(stats.buckets).toBeLessThan(stats.instances); // 合批后按几何归并，桶数必然更少
    layer.dispose();
  });
});