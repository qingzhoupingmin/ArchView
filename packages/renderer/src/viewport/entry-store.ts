/**
 * 组件显示条目仓库（架构拆分 Phase 3，自 `viewport.ts` 逐字迁出）
 *
 * 这里是渲染层的**场景对象内核**：`componentId → Entry` 增量缓存（§8.2-2）＋
 * T2.10g 的「双路并存」落点（同一件组件要么挂独立 mesh、要么进实例桶）。
 *
 * 三条不变式，改这个文件前请先读三遍：
 * 1. **`entry.group` 是位姿的唯一事实源**，直接拖拽期间它比 Document 领先一帧；
 *    全部写入必须走 `applyTransform` / `movePose` 这两个入口，别处一律只读。
 * 2. **共享几何绝不随条目释放**（T2.10f）——几何归 AssetRegistry 统一回收，本层只释放材质。
 * 3. **`solo` 只由 `wantsSolo()` 决定**（关批 / 被选中 / 正被拖拽），换路必须经 `syncSoloState`。
 */
import * as THREE from 'three';
import {
  instanceMatrixOf,
  mat4Identity,
  placePrimitive,
  primHalfExtents,
  primLocalMatrix,
  sizeRatio,
  visiblePrims,
  type Component,
  type ComponentType,
  type GeometryPrimitive,
  type LodLevel,
  type Vec3,
} from '@archview/core';
import { VP_COMPONENT_DEFAULT } from '@archview/theme';
import { BatchLayer, type BatchingMode } from '../instancing';
import type { AssetRegistry } from './assets';
import { primColorOf } from './assets';
import type { Entry } from './types';

export interface EntryStoreHost {
  /** 该组件是否在选中集里（选中件必须摘出成独立 mesh：描边 / 手柄 / 逐实例色都在 mesh 上做） */
  isSelected(id: string): boolean;
  /** 当前 LOD 档位：图元集合随档位变化 */
  lodMode(): LodLevel;
}

/* 批渲染包围盒计算的复用临时量（拾取 / 同步是热点路径，避免每次 new） */
const _localBox = new THREE.Box3();
const _localMatrix = new THREE.Matrix4();
const _primMatrix = new THREE.Matrix4();

export class EntryStore {
  private readonly scene: THREE.Scene;
  private readonly assets: AssetRegistry;
  private readonly host: EntryStoreHost;
  /**
   * 组件显示条目映射（T2.10f 拾取粗筛的输入源）。
   * 公开只为让门面能继续以 `this.entries` 读写转发（Phase 3 降低改动半径），
   * **除本类以外的写入一律禁止**——位姿与图形的唯一写入口是 applyTransform / movePose / refreshVisuals。
   */
  readonly entries = new Map<string, Entry>();
  /**
   * 实例化批渲染层（S2.5 / T2.10g）：`batching = 'on'` 时非选中组件的图元全部进它的桶。
   * 常驻场景图但可为空——`off` 档下桶被清空且整层隐藏，与旧实现完全等价（§B-2 双路并存）。
   */
  readonly batch = new BatchLayer();
  /** 批渲染开关（T2.10g）：渲染层初始 `off`，应用层启动时按 `initialBatching()` 同步（v3.10 起默认 on，X7 兜底） */
  private batchingNow: BatchingMode = 'off';
  /** 拖拽中被临时摘出成独立 mesh 的组件（T2.10h）：松手即清空，不在选择集里也照摘 */
  private readonly moveSoloIds = new Set<string>();

  constructor(scene: THREE.Scene, assets: AssetRegistry, host: EntryStoreHost) {
    this.scene = scene;
    this.assets = assets;
    this.host = host;
    // 批渲染容器（T2.10g）：常驻场景图，桶为空时不产生任何 draw call；初始关批 → 整层隐藏
    this.batch.root.visible = false;
    this.scene.add(this.batch.root);
  }

  /** 当前批渲染开关 */
  get batching(): BatchingMode {
    return this.batchingNow;
  }

  get(id: string): Entry | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  values(): IterableIterator<Entry> {
    return this.entries.values();
  }

  /** 批渲染读数（桶数 ≈ 单通道 draw call），`/fps` 基线页与状态栏共用 */
  getBatchStats(): { buckets: number; instances: number; capacity: number } {
    return this.batch.getStats();
  }

  /**
   * 开关实例化批渲染（T2.10g / T2.10h 的验收入口）：
   * - `off`：全场景回到 T2.10e~f 的「每图元一只 mesh」实现，桶清空并隐藏；
   * - `on`：非选中组件进桶（1 桶 = 1 draw call），选中件仍摘出来挂独立 mesh。
   * 两档之间画面必须逐像素一致，所以换档是**全量重建**而不是增量迁移（重建由门面编排）。
   */
  setBatching(mode: BatchingMode): void {
    if (mode === this.batchingNow) return;
    this.batchingNow = mode;
    this.batch.root.visible = mode === 'on';
    if (mode === 'off') this.batch.clear();
  }

  // ---------- 条目生命周期 ----------

  addOrUpdate(comp: Component, type: ComponentType): Entry {
    let entry = this.entries.get(comp.id);
    if (!entry) {
      entry = this.buildEntry(comp, type);
      this.entries.set(comp.id, entry);
      this.scene.add(entry.group);
    } else {
      const typeChanged = entry.type.id !== type.id;
      const colorChanged = (comp.color ?? '') !== entry.colorKey;
      // 活引用回写：applyTransform 不碰 comp / type，因为拖拽预览传的是临时合并对象，不能污染 Document 引用
      entry.comp = comp;
      entry.type = type;
      entry.colorKey = comp.color ?? '';
      // 换类型（图元集合变了）或改显示色才重建材质桶；纯移动 / 改尺寸不碰材质
      if (typeChanged || colorChanged) {
        this.syncSoloState(entry);
        if (entry.solo) this.syncMaterials(entry);
      }
      this.applyTransform(entry, comp);
    }
    return entry;
  }

  /**
   * 建一个组件的显示条目（T2.10e 层级 + T2.10g 双路）。
   * group 无论走哪条路都保留：它同时是**位姿事实源**（直接拖拽期间比 Document 领先一帧）、
   * 描边（BoxHelper）与 2D 标注的挂载点——批渲染只是不再往里塞 mesh。
   */
  private buildEntry(comp: Component, type: ComponentType): Entry {
    const group = new THREE.Group();
    group.userData.componentId = comp.id;
    // holder 与 group 同位姿、但尺寸比例写在每个图元自身上 → offset 的 anchor 语义才有意义
    const holder = new THREE.Group();
    group.add(holder);
    const entry: Entry = {
      group,
      holder,
      meshes: [],
      materials: new Map(),
      solo: true,
      primCache: [],
      primSource: null,
      primLod: 'far',
      batchPrims: [],
      comp,
      type,
      pose: { position: group.position, rotation: group.quaternion },
      box: new THREE.Box3(),
      boxDirty: true,
      colorKey: comp.color ?? '',
    };
    this.syncSoloState(entry);
    this.applyTransform(entry, comp);
    return entry;
  }

  /** 该组件该走哪条路：关批、被选中、或正被直接拖拽 → 独立 mesh（描边 / 手柄 / 逐实例色都在 mesh 上做） */
  private wantsSolo(entry: Entry): boolean {
    const id = entry.comp.id;
    return this.batchingNow === 'off' || this.host.isSelected(id) || this.moveSoloIds.has(id);
  }

  /**
   * 切双路（T2.10g 的「选中摘出」与 T2.10h 的「一键回退」都走这里）。
   * 进批时立即释放独立 mesh 的材质（否则选中一次泄漏一组材质），出批时反向重建图形。
   * @returns 真的换了路才返回 true（调用方据此决定是否要重算材质 / 描边）
   */
  private syncSoloState(entry: Entry): boolean {
    const want = this.wantsSolo(entry);
    if (want === entry.solo) return false;
    if (!want) {
      // 出独立 mesh、进桶：mesh 与材质当场释放（几何是共享的，不动），图元数据留给批路径复用
      for (const mat of entry.materials.values()) mat.dispose();
      entry.materials.clear();
      entry.meshes.length = 0;
      entry.holder.clear();
      this.batch.remove(entry.comp.id);
    }
    // 反向（桶 → 独立 mesh）不必在这里建：refreshEntryVisuals 发现 meshes 为空会自己建，
    // 且必须保留 primCache——批路径还要靠它算图元。
    entry.solo = want;
    return true;
  }

  /** 只销毁图形（材质）与实例，不动选择集、不释放共享几何——供 remove 与 LOD 重建复用（T2.10f） */
  disposeEntry(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.scene.remove(entry.group);
    this.batch.remove(id); // 批渲染路径：图元在桶里，group 里没有 mesh
    // 几何来自 AssetRegistry（跨实例共享），此处只释放本组件持有的材质
    for (const mat of entry.materials.values()) mat.dispose();
    entry.materials.clear();
    entry.meshes.length = 0;
    entry.batchPrims.length = 0;
    entry.primCache.length = 0;
    entry.holder.clear();
    entry.group.clear();
    this.entries.delete(id);
  }

  /**
   * 摘掉一个组件的显示条目。
   * @returns 该条目此前确实存在（门面据此决定是否要剔除选择集）
   */
  remove(id: string): boolean {
    if (!this.entries.has(id)) return false;
    this.disposeEntry(id);
    return true;
  }

  clear(): void {
    for (const id of [...this.entries.keys()]) this.disposeEntry(id);
  }

  /**
   * 选择集 / 拖拽临时态 → 双路对账（T2.10g）：把该进桶的进桶、该摘出的摘出。
   * @returns 真的换了路的组件数（0 = 无变化）
   */
  syncSoloStates(): number {
    if (this.batchingNow !== 'on') return 0;
    let n = 0;
    for (const entry of this.entries.values()) {
      if (this.syncSoloState(entry)) {
        this.refreshVisuals(entry);
        n++;
      }
    }
    if (n > 0) this.batch.flush();
    return n;
  }

  /**
   * 直接拖拽中的组件临时摘出实例桶挂独立 mesh（T2.10g「选中摘出」的同一条机制）。
   * 2D 框选整排机柜再拖动时，逐帧往桶里回写矩阵远不如临时转独立 mesh，松手提交后自动归桶。
   */
  beginMoveSolo(ids: Iterable<string>): void {
    if (this.batchingNow !== 'on') return;
    let added = 0;
    for (const id of ids) {
      if (this.moveSoloIds.has(id)) continue;
      this.moveSoloIds.add(id);
      added++;
    }
    if (added > 0) this.syncSoloStates();
  }

  /** 拖拽结束：清临时态并按当前选择集归位（仍在选择集里的继续走独立 mesh） */
  endMoveSolo(): void {
    if (this.moveSoloIds.size === 0) return;
    this.moveSoloIds.clear();
    this.syncSoloStates();
  }

  // ---------- 图形刷新（S2.5 素材承载层：逐图元材质 / anchor 缩放语义 / 双路分叉） ----------

  /** 实例尺寸比例：size / defaultSize（FR-M03）× comp.scale（FR-M06）；defaultSize 为 0 的轴由 core 回退 1 */
  private ratioOf(comp: Component, type: ComponentType): Vec3 {
    const r = sizeRatio(comp, type);
    return { x: r.x * comp.scale.x, y: r.y * comp.scale.y, z: r.z * comp.scale.z };
  }

  /** 当前档位参与渲染的图元快照（类型或档位变了才重算，供双路与拾取共用） */
  private primCacheOf(entry: Entry): GeometryPrimitive[] {
    const lod = this.host.lodMode();
    if (entry.primSource !== entry.type || entry.primLod !== lod) {
      entry.primSource = entry.type;
      entry.primLod = lod;
      entry.primCache = visiblePrims(entry.type, lod);
      entry.meshes.length = 0;
      entry.batchPrims.length = 0;
      entry.holder.clear();
    }
    return entry.primCache;
  }

  /** 建独立 mesh（solo 路径，图元集合变化 / 从桶里摘出来时调用）；材质当场按逐图元档手上 */
  private buildSoloMeshes(entry: Entry, prims: GeometryPrimitive[]): void {
    // 旧 mesh 即将整体丢弃：它们只被本条目引用，材质必须当场释放（几何是共享的，不动）
    for (const mat of entry.materials.values()) mat.dispose();
    entry.materials.clear();
    entry.meshes.length = 0;
    entry.holder.clear();
    for (const prim of prims) {
      const mesh = new THREE.Mesh(
        this.assets.geometryOf(prim),
        this.assets.makeMaterial(entry.materials, prim, entry.comp, entry.type),
      );
      mesh.userData.componentId = entry.comp.id;
      if (prim.name) mesh.name = prim.name; // 子部件语义名（L2）：拾取 / U 位 / 剖切寻址用
      mesh.castShadow = prim.castShadow ?? true;
      mesh.receiveShadow = true;
      entry.holder.add(mesh);
      entry.meshes.push(mesh);
    }
  }

  /**
   * 刷新一个组件的图形（T2.10g 双路的唯一分叉点）。
   *
   * - **solo 路**：与 T2.10e 的实现逐字一致（mesh 挂在 holder 下、尺寸比写在 mesh 自身、
   *   包围盒交回拾取路径懒算）——`batching = 'off'` 时全场景走这一支，保证「一键回退 = 现状」。
   * - **批路**：只更新 `batchPrims` 的槽位数据（对象复用、矩阵就地重写），再交给 `BatchLayer.set`；
   *   group 是空容器，包围盒必须在这里按图元算好（`boxDirty = false`），否则粗筛会得到空盒。
   */
  refreshVisuals(entry: Entry, comp: Component = entry.comp): void {
    const prims = this.primCacheOf(entry);
    const ratio = this.ratioOf(comp, entry.type);
    // 显隐（FR-D05 / 验收清单第 3 项）：`comp.visible` 此前在渲染层**从未被读取**，
    // 属性面板那个勾选框是个死开关。批渲染下不能再靠 group 继承可见性（桶里的实例与 group 无关），
    // 故两条路各自处理：solo 关容器可见性，批路径直接从桶里摘掉并把包围盒收成空盒（不可点中）。
    const hidden = comp.visible === false;
    if (entry.solo) {
      entry.group.visible = !hidden;
      if (entry.meshes.length !== prims.length) this.buildSoloMeshes(entry, prims);
      for (let i = 0; i < prims.length; i++) {
        const prim = prims[i]!;
        const mesh = entry.meshes[i]!;
        const placed = placePrimitive(prim, ratio);
        mesh.position.set(placed.position.x, placed.position.y, placed.position.z);
        mesh.scale.set(placed.scale.x, placed.scale.y, placed.scale.z);
      }
      entry.boxDirty = true;
      return;
    }
    if (hidden) {
      this.batch.remove(entry.comp.id);
      entry.box.makeEmpty();
      entry.boxDirty = false;
      return;
    }
    // 桶路径：几何 / 材质档 / 色全部就地刷新（换色换档时桶键随之变化，set 会自动摘旧挂新）
    if (entry.batchPrims.length > prims.length) entry.batchPrims.length = prims.length;
    for (let i = 0; i < prims.length; i++) {
      const prim = prims[i]!;
      let slot = entry.batchPrims[i];
      if (!slot) {
        slot = {
          slot: prim.material ?? 'matte',
          castShadow: true,
          matrix: mat4Identity(),
          color: VP_COMPONENT_DEFAULT,
          geometry: this.assets.geometryOf(prim),
        };
        entry.batchPrims[i] = slot;
      }
      slot.slot = prim.material ?? 'matte';
      slot.castShadow = prim.castShadow ?? true;
      slot.geometry = this.assets.geometryOf(prim);
      slot.color = primColorOf(comp, prim, entry.type);
    }
    this.refreshBatchMatrices(entry, comp);
  }

  /**
   * 只重写实例矩阵并回桶（位姿变了、结构没变的热路径：直接拖拽逐帧）。
   * 顺带刷新包围盒——批渲染的 group 是空容器，拾取粗筛只能信这份算出来的盒。
   */
  private refreshBatchMatrices(entry: Entry, comp: Component = entry.comp): void {
    // 隐藏件不入桶（否则拖拽 / 变换会把「已勾掉显隐」的组件又画回来）
    if (comp.visible === false) {
      this.batch.remove(entry.comp.id);
      entry.box.makeEmpty();
      entry.boxDirty = false;
      return;
    }
    const ratio = this.ratioOf(comp, entry.type);
    const prims = entry.primCache;
    for (let i = 0; i < entry.batchPrims.length; i++) {
      const prim = prims[i];
      const slot = entry.batchPrims[i];
      if (!prim || !slot) continue;
      slot.matrix = instanceMatrixOf(entry.pose, prim, ratio);
    }
    this.batch.set(entry.comp.id, entry.batchPrims);
    this.computeEntryBox(entry, prims, ratio);
  }

  /**
   * 直接拖拽的位姿写入（T2.10h）：`group` 是渲染层的位姿事实源（比 Document 提交领先一帧）。
   * solo 路径的 mesh 是它的子节点会自动跟随，但批路径的实例矩阵必须显式重写——
   * 否则松手提交前，桶里那个实例还留在原地，画面与拾取双重错位。
   */
  movePose(entry: Entry, x: number, z: number): void {
    entry.group.position.x = x;
    entry.group.position.z = z;
    entry.group.updateMatrix();
    if (entry.solo) entry.boxDirty = true;
    else this.refreshBatchMatrices(entry);
  }

  /**
   * 批渲染的组件包围盒：逐图元「局部 AABB × (group 位姿 × 图元局部矩阵)」求并。
   * 与旧 `Box3.setFromObject(group)` 等价（几何都是以原点为中心的 box / cylinder），
   * 但不需要场景节点——合批后 group 里已经没有 mesh 了。
   */
  private computeEntryBox(entry: Entry, prims: GeometryPrimitive[], ratio: Vec3): void {
    entry.box.makeEmpty();
    for (const prim of prims) {
      const h = primHalfExtents(prim);
      _localBox.min.set(-h.x, -h.y, -h.z);
      _localBox.max.set(h.x, h.y, h.z);
      _localMatrix
        .copy(entry.group.matrix)
        .multiply(_primMatrix.fromArray(primLocalMatrix(prim, ratio) as number[]));
      _localBox.applyMatrix4(_localMatrix);
      entry.box.union(_localBox);
    }
    entry.boxDirty = false;
  }

  /**
   * 位姿写进 group（T2.10e / §8.2-9）：尺寸比例与图元偏移由 `refreshVisuals` 落到
   * 每条路径自己的载体上——solo 写 `mesh.position/scale`，批渲染写实例矩阵。
   * 旧实现把 scale 挂在 group 上，图元 offset 会被一起缩放——吊顶 / 壁挂件改高度后安装高度按比例
   * 漂移（开发计划 §4.2 T2.9 D-1），故 offset 始终按 `anchor` 语义单独处理。
   */
  applyTransform(entry: Entry, comp: Component): void {
    entry.group.position.set(comp.position.x, comp.position.y, comp.position.z);
    entry.group.quaternion.set(comp.rotation.x, comp.rotation.y, comp.rotation.z, comp.rotation.w);
    entry.group.updateMatrix();
    this.refreshVisuals(entry, comp);
  }

  /**
   * 刷新材质桶（T2.10d）：实例改色 / 换类型后重建桶、重指 mesh.material，并释放不再使用的旧材质。
   * 仅尺寸或位置变化不需要走这里（那些只改 transform）。
   * 批渲染路径没有 mesh 材质桶（逐实例色走 `instanceColor`），改色由 `refreshVisuals` 刷槽位。
   */
  private syncMaterials(entry: Entry): void {
    if (!entry.solo) return;
    const prims = this.primCacheOf(entry);
    if (entry.meshes.length !== prims.length) {
      this.buildSoloMeshes(entry, prims);
      return;
    }
    const next = new Map<string, THREE.MeshStandardMaterial>();
    for (let i = 0; i < entry.meshes.length; i++) {
      const prim = prims[i];
      const mesh = entry.meshes[i];
      if (!prim || !mesh) continue;
      mesh.material = this.assets.makeMaterial(next, prim, entry.comp, entry.type);
    }
    const kept = new Set<THREE.MeshStandardMaterial>(next.values());
    for (const mat of entry.materials.values()) {
      // 按对象身份判断而不是按键：同名同色但实例是新建的，旧那份已无人引用，必须释放
      // （旧实现写 `!next.has(key)` 恰好漏掉这一支，等于每次改色泄漏一组材质）
      if (!kept.has(mat)) mat.dispose();
    }
    entry.materials = next;
    entry.colorKey = entry.comp.color ?? '';
  }

  /** 本层不持有共享几何（那是 AssetRegistry 的事），只回收桶与桶材质 */
  dispose(): void {
    this.batch.dispose();
  }
}