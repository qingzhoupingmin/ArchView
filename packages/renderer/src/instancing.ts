/**
 * 实例化批渲染（S2.5 / T2.10g，开发计划 §4.3 T5.0、产品文档 §8.2-11 ③）。
 *
 * ## 要解决的问题
 * 旧路径每个图元 `new THREE.Mesh` ⇒ **1 图元 = 1 draw call**，而 `geoCache` 只共享几何、
 * 一个 draw call 都省不掉（产品文档 §8.2-11 ③ 点名的「最容易误判的一条」）。素材精修（T2.11）
 * 把 far 档图元从 56 推到 108 之后，1000 组件场景的 draw call 按图元数线性放大（风险 X10）。
 * 这里把「同几何 + 同材质档 + 同投影口径」的图元实例压进一只 `InstancedMesh`：
 * 位姿进 `instanceMatrix`、逐实例色进 `instanceColor`，**桶数 ≈ draw call 数**（阴影通道再 ×2）。
 *
 * ## 分桶键为什么是「图元序号 + 几何 + 材质档 + 投影」而不是任务卡原写的 `typeId × primIndex`
 * 渲染只需要「同一份几何 + 同一份材质」这两件事，`typeId` 只是它们的来源。用 `geometry.uuid`
 * 作键，跨类型的同尺寸子部件（如 `it-rack42` 与 `rack-mesh` 的 600×2000×1000 壳体）会**自动合桶**，
 * 桶数只少不多；序号则用来守住「每组件每桶至多一个实例」这条不变量（详见 `bucketKey` 的注释）。
 *
 * ## 三条硬约束（改这个文件前先读）
 * 1. **几何是共享的**：来自渲染层 `geoCache`，本模块**绝不 dispose 几何**——只 dispose 桶自身
 *    （`InstancedMesh.dispose()` 仅回收 `instanceMatrix` / `instanceColor` 两条 GPU buffer）。
 * 2. **实例矩阵是世界矩阵**：桶挂在 identity 容器下，位姿全部烘进矩阵，所以拖拽预览 / 变换
 *    手柄只需重写那一条矩阵；数学口径由 core `instanceMatrixOf` 单一事实源保证与旧三层结构逐元素等价。
 * 3. **拾取不走 `InstancedMesh.raycast`**：它对整桶每个实例做一次矩阵求逆 + 求交，且整桶只有
 *    一个包围球（横跨全场景 ⇒ 粗筛必然通过），1000 组件下比旧路径更慢。这里改用调用方给出的
 *    候选组件（已由组件级 `Box3` 粗筛）+ 复用一只探针 Mesh 逐实例精确求交。
 */
import * as THREE from 'three';
import type { MaterialSlot } from '@archview/core';
import { MAT_PRESETS } from '@archview/theme';

/** 批渲染开关（开发计划 S2.5 §B-2「双路并存」：`off` 档必须与旧实现逐像素一致） */
export type BatchingMode = 'off' | 'on';

/** 一次拾取命中（与 solo 路径的命中合并后按 `distance` 升序 → 穿透选择口径不变） */
export interface BatchHit {
  id: string;
  distance: number;
}

/** 入桶的一个图元实例（由 `Viewport3D` 按 `visiblePrims(type, lod)` 顺序产出） */
export interface BatchPrim {
  /** 材质档：决定用哪份桶材质 */
  slot: MaterialSlot;
  /** 是否投影：与几何同键固化进桶（同图元同口径，桶内恒定） */
  castShadow: boolean;
  /** 世界矩阵，列主序 16（core `instanceMatrixOf` 产出，与 `Matrix4.elements` 同序） */
  matrix: readonly number[];
  /** 逐实例显示色（已含 tint 与「实例色 → 图元色 → 默认灰」回退链） */
  color: string;
  /** 共享几何（渲染层 geoCache 持有，本模块只引用） */
  geometry: THREE.BufferGeometry;
}

/** 新建桶的初始容量；后续按 2× 倍增（避免密集阵列逐台增建时反复重分配） */
const INITIAL_CAPACITY = 16;

/** `emissive` 档自发光色的着色器注入点（three `meshphysical.glsl.js` 内的原始一行） */
const EMISSIVE_ANCHOR = 'vec3 totalEmissiveRadiance = emissive;';
/** 注入后的那行：让自发光也跟着 `instanceColor`（否则机柜 LED 合批后会褪成同一个白） */
const EMISSIVE_PATCHED = 'vec3 totalEmissiveRadiance = emissive * vColor;';

/**
 * 是否给 `emissive` 档桶材质打「自发光乘 vColor」的补丁。
 * `false` = 退回「桶材质自发光固定为白 × intensity」，LED 失去逐实例色（观感退化但不报错），
 * 作为着色器补丁在极端驱动上失效时的**一行兜底开关**。
 */
export const BATCH_EMISSIVE_VCOLOR = true;

/**
 * 把「自发光乘 vColor」注进物理着色器。
 * `instanceColor` 默认只影响漫反射（three 的 `color_fragment` 在 `totalEmissiveRadiance`
 * 赋值之后才执行），故 emissive 档必须显式补这一刀。找不到锚点（three 大版本改了写法）时
 * 原样返回，让材质退化成「白色自发光」而不是崩掉——由 `instancing.test.ts` 盯住锚点存在性。
 */
export function applyEmissiveVColorPatch(fragmentShader: string): string {
  if (!fragmentShader.includes(EMISSIVE_ANCHOR)) return fragmentShader;
  return fragmentShader.replace(EMISSIVE_ANCHOR, EMISSIVE_PATCHED);
}

/**
 * 桶键：**图元序号** + 几何（含种类与尺寸）+ 材质档 + 投影口径。
 *
 * 序号是必须的，不是省事：机柜家族的对称子部件（`rail-l` / `rail-r`、`frame-l` / `frame-r`、
 * `end-w` / `end-e`、`trim-n` / `trim-s`、`door` / `door-2`）几何、材质档、投影口径**完全相同**，
 * 只按后三者合桶会让同一组件的两个图元落进同一桶 —— 一个组件在一桶里只能记一个槽位，
 * 后写的会覆盖前一个，结果是删除组件时那个实例留在原地变成**删不掉的幽灵**。
 * 实测 far 档这样的碰撞有 9 对（含 near 共 11 型），全在精修后的机柜 / 门 / 地板家族上。
 * 加上序号即恢复「每组件每桶至多一个实例」这条不变量，且跨类型的同序同几何子部件仍会合桶
 * （机柜家族刻意共用一套子部件命名与坐标语言，序号天然对齐）。
 */
function bucketKey(primIndex: number, prim: BatchPrim): string {
  return `${primIndex}|${prim.geometry.uuid}|${prim.slot}|${prim.castShadow ? 1 : 0}`;
}

interface Bucket {
  key: string;
  mesh: THREE.InstancedMesh;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** 实例槽位 → 组件 ID（null = 空槽）；长度恒等于容量 */
  ids: (string | null)[];
  /** 活实例数（同步到 `mesh.count`，尾部之外的槽位不参与渲染与求交） */
  count: number;
}

/** 一个组件在各桶里的落位：bucketKey → 槽位序号 */
type Placement = Map<string, number>;

/**
 * 拾取探针的窄化视图：three 运行时的 `Mesh.raycast` 会读 `this.boundingSphere` 做粗筛（r165+），
 * 但 `@types/three` 0.169 只在 `InstancedMesh` 上声明了这个属性。换几何时必须刷新它，
 * 否则探针会拿上一只组件的包围球来判这一只 —— 表现为「点得中却选不中」的偶发漏检。
 */
type ProbeMesh = THREE.Mesh & { boundingSphere: THREE.Sphere | null };

/**
 * 批渲染层：持有全部 `InstancedMesh` 桶 + `compId → 槽位` 反查表。
 * 由 `Viewport3D` 在 `batching = 'on'` 时驱动；`off` 时整层清空并隐藏（双路并存，X7 兜底）。
 */
export class BatchLayer {
  /** 桶容器：恒等变换（世界矩阵已烘进实例矩阵），整体随视口挂载 / 释放 */
  readonly root = new THREE.Group();
  private readonly buckets = new Map<string, Bucket>();
  private readonly placements = new Map<string, Placement>();
  /** 桶材质按材质档共享（颜色走 instanceColor，故材质本身与实例无关） */
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  /** 本帧待上传 GPU 的脏桶（flush 前反复写只置一次集合） */
  private readonly dirty = new Set<string>();
  private instances = 0;

  /** 拾取探针：复用一只 Mesh，逐实例把矩阵塞给它做精确求交 */
  private readonly probe = new THREE.Mesh() as ProbeMesh;
  private readonly _m = new THREE.Matrix4();
  private readonly _c = new THREE.Color();
  private readonly _sphere = new THREE.Sphere();
  private readonly _hits: THREE.Intersection[] = [];

  constructor() {
    this.root.name = 'archview:batch';
    this.probe.name = 'archview:pick-probe';
  }

  /** 该组件是否已在批渲染层里（决定它要不要保留独立 mesh） */
  has(id: string): boolean {
    return this.placements.has(id);
  }

  /** 当前实例总数（= 参与合批的图元数，不含被摘成 solo 的选中件） */
  get instanceCount(): number {
    return this.instances;
  }

  /** 诊断读数：桶数即 draw call 数（单渲染通道），T2.10g 验收「1000 组件 ≤ 64 calls」看这里 */
  getStats(): { buckets: number; instances: number; capacity: number } {
    let capacity = 0;
    for (const b of this.buckets.values()) capacity += b.ids.length;
    return { buckets: this.buckets.size, instances: this.instances, capacity };
  }

  /**
   * 写入 / 整体覆盖一个组件的实例集合。
   * 一律「先摘后挂」：图元数变化（换类型、升降 LOD）与尺寸变化（ratio 变了）都不必分支判断，
   * 单组件摘挂是 O(图元数) 的尾部交换，逐帧拖拽也只重写它那几条矩阵。
   */
  set(id: string, prims: readonly BatchPrim[]): void {
    this.remove(id);
    if (prims.length === 0) return;
    const place: Placement = new Map();
    for (let i = 0; i < prims.length; i++) {
      const prim = prims[i]!;
      const key = bucketKey(i, prim);
      const bucket = this.bucketFor(key, prim);
      const index = this.acquire(bucket, id);
      bucket.mesh.setMatrixAt(index, this._m.fromArray(prim.matrix as number[]));
      bucket.mesh.setColorAt(index, this._c.set(prim.color));
      place.set(key, index);
      this.dirty.add(key);
    }
    this.placements.set(id, place);
    this.instances += prims.length;
  }

  /** 摘掉一个组件的全部实例（删除组件 / 被选中而转独立 mesh / LOD 重建） */
  remove(id: string): void {
    const place = this.placements.get(id);
    if (!place) return;
    this.placements.delete(id);
    let removed = 0;
    for (const [key, index] of place) {
      const bucket = this.buckets.get(key);
      if (!bucket) continue;
      this.releaseAt(bucket, index);
      removed++;
      if (bucket.count === 0) this.dropBucket(bucket);
      else this.dirty.add(key);
    }
    this.instances -= removed;
  }

  /** 清空全部实例与桶（关闭批渲染 / 工程全量重建）；材质保留复用 */
  clear(): void {
    for (const bucket of [...this.buckets.values()]) this.dropBucket(bucket);
    this.buckets.clear();
    this.placements.clear();
    this.dirty.clear();
    this.instances = 0;
  }

  /**
   * 每帧渲染前调用：把脏桶的矩阵 / 颜色 buffer 标脏并刷新包围球。
   * 只处理脏桶——1000 组件场景里拖一台机柜只写 8 条矩阵、上传 1~2 个 buffer。
   */
  flush(): void {
    if (this.dirty.size === 0) return;
    for (const key of this.dirty) {
      const bucket = this.buckets.get(key);
      if (!bucket) continue;
      bucket.mesh.instanceMatrix.needsUpdate = true;
      if (bucket.mesh.instanceColor) bucket.mesh.instanceColor.needsUpdate = true;
      // 实例位置变了 → 整桶包围球要重算，否则视锥剔除会按旧球把新位置的实例裁掉（「拖走就消失」）
      bucket.mesh.computeBoundingSphere();
    }
    this.dirty.clear();
  }

  /**
   * 精确拾取：`candidateIds` 由调用方用组件级 `Box3` 粗筛给出（与 solo 路径同一份包围盒）。
   * 结果**不排序**——与 solo 命中合并后统一按 distance 排序，穿透选择口径保持不变。
   */
  pick(raycaster: THREE.Raycaster, candidateIds: Iterable<string>, out: BatchHit[]): void {
    for (const id of candidateIds) {
      const place = this.placements.get(id);
      if (!place) continue;
      for (const [key, index] of place) {
        const bucket = this.buckets.get(key);
        if (!bucket || index >= bucket.count) continue;
        if (!raycaster.ray.intersectsSphere(this.instanceSphere(bucket, index))) continue;
        bucket.mesh.getMatrixAt(index, this._m);
        this.probe.geometry = bucket.geometry;
        this.probe.material = bucket.material;
        if (bucket.geometry.boundingSphere === null) bucket.geometry.computeBoundingSphere();
        this.probe.boundingSphere = bucket.geometry.boundingSphere;
        this.probe.matrixWorld.copy(this._m);
        this._hits.length = 0;
        this.probe.raycast(raycaster, this._hits);
        for (const hit of this._hits) out.push({ id, distance: hit.distance });
      }
    }
  }

  /** 释放整层：桶与材质彻底回收（几何归 `geoCache`，由视口统一释放） */
  dispose(): void {
    this.clear();
    for (const mat of this.materials.values()) mat.dispose();
    this.materials.clear();
    this.root.parent?.remove(this.root);
  }

  // ---------------- 内部实现 ----------------

  /** 取桶，不存在则建（初始容量 `INITIAL_CAPACITY`，之后 2× 倍增） */
  private bucketFor(key: string, prim: BatchPrim): Bucket {
    const existing = this.buckets.get(key);
    if (existing) return existing;
    // 零厚度 plane（屏面 / 玻璃面板）必须双面，否则背面视角整面消失——与 solo 路 makeMaterial 同口径
    const material = this.materialFor(prim.slot, prim.geometry instanceof THREE.PlaneGeometry);
    const mesh = new THREE.InstancedMesh(prim.geometry, material, INITIAL_CAPACITY);
    mesh.name = `bucket:${prim.slot}`;
    mesh.count = 0;
    mesh.castShadow = prim.castShadow;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    const bucket: Bucket = {
      key,
      mesh,
      geometry: prim.geometry,
      material,
      ids: new Array<string | null>(INITIAL_CAPACITY).fill(null),
      count: 0,
    };
    this.buckets.set(key, bucket);
    return bucket;
  }

  /**
   * 桶材质：六档光学参数照旧（`MAT_PRESETS`），但 **color 固定纯白**——
   * 逐实例色由 `instanceColor` 乘进来（three 在 `instancingColor` 为真时会给**片段**着色器
   * 定义 `USE_COLOR`，`color_fragment` 于是执行 `diffuseColor.rgb *= vColor`）。
   * 于是材质实例数从「档 × 颜色」组合退回「档」。
   */
  private materialFor(slot: MaterialSlot, doubleSide = false): THREE.MeshStandardMaterial {
    const key = doubleSide ? `${slot}|ds` : slot;
    const cached = this.materials.get(key);
    if (cached) return cached;
    const p = MAT_PRESETS[slot];
    const mat = new THREE.MeshStandardMaterial({
      name: `batch:${key}`,
      color: 0xffffff,
      roughness: p.roughness,
      metalness: p.metalness,
    });
    if (doubleSide) {
      // 零厚度屏面 / 玻璃面板：FrontSide 在背面视角会整面消失（与 solo 路 makeMaterial 同口径）
      mat.side = THREE.DoubleSide;
    }
    if (p.opacity < 1) {
      mat.transparent = true;
      mat.opacity = p.opacity;
      // 半透明不写深度（与 solo 路径同一处理）；合批后失去逐实例排序，靠深度测试兜住与不透明件的层叠
      mat.depthWrite = false;
    }
    if (p.emissive > 0) {
      mat.emissive = new THREE.Color(0xffffff);
      mat.emissiveIntensity = p.emissive;
      if (BATCH_EMISSIVE_VCOLOR) {
        mat.onBeforeCompile = (shader): void => {
          shader.fragmentShader = applyEmissiveVColorPatch(shader.fragmentShader);
        };
        // 打过补丁的着色器必须是独立的 program，否则会跟未打补丁的同参材质共用缓存程序
        mat.customProgramCacheKey = (): string => 'archview/batch-emissive-vcolor';
      }
    }
    this.materials.set(key, mat);
    return mat;
  }

  /** 占一个空槽（满了先倍增容量），登记槽位归属 */
  private acquire(bucket: Bucket, id: string): number {
    if (bucket.count >= bucket.ids.length) this.growBucket(bucket, bucket.ids.length * 2);
    const index = bucket.count++;
    bucket.ids[index] = id;
    bucket.mesh.count = bucket.count;
    return index;
  }

  /**
   * 释放槽位：**尾部交换**（把最后一个实例搬进空位），保证 `[0, count)` 恒为连续活区间。
   * 被搬走的组件必须同步改它自己的槽位记录，否则下次删除会认错位置（悬空 / 删不掉）。
   */
  private releaseAt(bucket: Bucket, index: number): void {
    const last = bucket.count - 1;
    if (index < 0 || index > last) return;
    if (index !== last) {
      const movedId = bucket.ids[last];
      bucket.mesh.getMatrixAt(last, this._m);
      bucket.mesh.setMatrixAt(index, this._m);
      const colors = bucket.mesh.instanceColor;
      if (colors) {
        const arr = colors.array as Float32Array;
        arr[index * 3] = arr[last * 3]!;
        arr[index * 3 + 1] = arr[last * 3 + 1]!;
        arr[index * 3 + 2] = arr[last * 3 + 2]!;
      }
      bucket.ids[index] = movedId ?? null;
      if (movedId) this.placements.get(movedId)?.set(bucket.key, index);
    }
    bucket.ids[last] = null;
    bucket.count = last;
    bucket.mesh.count = bucket.count;
  }

  /** 容量倍增：新建更大的 InstancedMesh、整块拷矩阵与颜色，旧桶立即 dispose（不碰共享几何） */
  private growBucket(bucket: Bucket, capacity: number): void {
    const old = bucket.mesh;
    const next = new THREE.InstancedMesh(bucket.geometry, bucket.material, capacity);
    next.name = old.name;
    next.count = bucket.count;
    next.castShadow = old.castShadow;
    next.receiveShadow = old.receiveShadow;
    (next.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    if (old.instanceColor) {
      const colors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
      (colors.array as Float32Array).set(old.instanceColor.array as Float32Array);
      next.instanceColor = colors;
    }
    this.root.remove(old);
    old.dispose(); // 只回收 instanceMatrix / instanceColor 两条 buffer（几何是共享的，绝不能再释放）
    this.root.add(next);
    bucket.mesh = next;
    bucket.ids.length = capacity; // 新增槽位是 undefined，语义等同空槽
  }

  /** 空桶回收：材质保留（同档还要复用），几何不动 */
  private dropBucket(bucket: Bucket): void {
    this.root.remove(bucket.mesh);
    bucket.mesh.dispose();
    this.buckets.delete(bucket.key);
    this.dirty.delete(bucket.key);
  }

  /** 实例的世界包围球：局部球 × 实例矩阵（`Sphere.applyMatrix4` 按最大轴长放大，是上界故不漏检） */
  private instanceSphere(bucket: Bucket, index: number): THREE.Sphere {
    if (bucket.geometry.boundingSphere === null) bucket.geometry.computeBoundingSphere();
    bucket.mesh.getMatrixAt(index, this._m);
    return this._sphere.copy(bucket.geometry.boundingSphere!).applyMatrix4(this._m);
  }
}