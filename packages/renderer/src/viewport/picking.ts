/**
 * 拾取管线（架构拆分 Phase 1，自 `viewport.ts` 逐字迁出）
 *
 * 双路拾取的纯函数部分——它不持有任何状态，只吃「条目集合 + 射线」，
 * 因此可以脱离 DOM 在 node 环境里被单测锁死（见 `../viewport.pick.test.ts`）。
 */
import * as THREE from 'three';
import type { BatchLayer } from '../instancing';
import type { PickEntry, PickHit } from './types';

/**
 * 拾取核心（T2.10f 粗筛 + 精确求交，抽为纯函数由单测锁死，见 viewport.pick.test.ts）：
 * ① 世界包围盒粗筛（懒算 + 变换置脏）——射线不经过的组件不参与三角形求交；
 * ② `recursive=false` 逐 mesh 求交——**不能传 holder 容器**：holder 自身无几何体，
 *    T2.10e 层级重构（group > holder > mesh）后曾把命中目标改成 holder 却忘了切 recursive，
 *    射线永不命中 → 左键选择 / 拖组件直接移动 / 双击聚焦 / 右键详情全失效（产品文档 v0.14）。
 * 返回命中组件 ID（近 → 远，同组件多图元去重，穿透选择依赖该顺序）。
 */
export function pickComponentIds(
  raycaster: THREE.Raycaster,
  entries: Iterable<PickEntry>,
): string[] {
  return pickHits(raycaster, entries, null).ids;
}

/**
 * 双路拾取（T2.10g / T2.10h）：组件级 `Box3` 粗筛后分流——独立 mesh 走 `intersectObjects`、
 * 实例桶走 `BatchLayer.pick` 的探针求交，两路命中**按世界距离合并排序**再按组件去重。
 *
 * 为什么必须合并排序而不是「先 solo 后批」：穿透选择（同位连点逐层）与右键详情都依赖全局
 * 近 → 远顺序，而「选中一台机柜、旁边的机柜仍在桶里」是常态。
 */
export function pickHits(
  raycaster: THREE.Raycaster,
  entries: Iterable<PickEntry>,
  batch: BatchLayer | null,
): { ids: string[]; hits: PickHit[] } {
  const targets: THREE.Object3D[] = [];
  const candidates: string[] = [];
  const hits: PickHit[] = [];
  for (const entry of entries) {
    if (entry.boxDirty) {
      entry.group.updateMatrixWorld(true);
      entry.box.setFromObject(entry.group, true);
      entry.boxDirty = false;
    }
    if (!raycaster.ray.intersectsBox(entry.box)) continue;
    if (entry.solo === false && batch && entry.id) candidates.push(entry.id);
    else targets.push(...entry.meshes);
  }
  for (const h of raycaster.intersectObjects(targets, false)) {
    const id = h.object.userData.componentId;
    if (typeof id === 'string') hits.push({ id, distance: h.distance });
  }
  if (candidates.length > 0 && batch) batch.pick(raycaster, candidates, hits);
  hits.sort((a, b) => a.distance - b.distance);
  const ids: string[] = [];
  for (const h of hits) if (!ids.includes(h.id)) ids.push(h.id);
  return { ids, hits };
}
