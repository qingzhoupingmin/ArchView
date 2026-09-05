/**
 * 设备排纯函数（T3.1，产品文档 §8.2-12）。
 *
 * 拆在这里而不是写进 UI 的两条理由：
 * 1. 「按布局自动成排」的聚类判定必须能单测锁死（黄金样例要断言「恰好得到 A 排 10 + B 排 10」）；
 * 2. 统计层（stats.ts）与属性面板要共用同一份「谁是成员 / 谁没成排」的口径，避免两处各算一遍。
 *
 * 单位一律 mm、XZ 平面，与 room.ts 同口径。
 */
import { yawDegrees } from './transform';
import type { Component, ComponentType, RackRow } from './types';

/** 排的排列轴向：`x` = 成员沿 X 递增排开（柜面朝 ±Z），`z` 同理 */
export type RowAxis = 'x' | 'z';

/** 一个候选排簇（自动成排的输出；componentIds 按主轴升序 = 柜位 1..n 的天然顺序） */
export interface RowCluster {
  axis: RowAxis;
  /** 所属房间（与成员 roomId 一致；未分配房间的成员归为 undefined 一桶） */
  roomId?: string;
  componentIds: string[];
}

export interface InferRowsOptions {
  /**
   * 该组件是否参与成排。**建议由调用方按类型判定**（配 `isRackComponent`），
   * 缺省回退「实例 attrs 带 ratedPowerW」——机柜族素材全有该字段，但类型判定更准。
   */
  isCandidate?: (c: Component) => boolean;
  /** 同排相邻两台的最大中心间距（mm），超出即断排。缺省 2000 */
  maxGap?: number;
  /** 横向容差（mm）：与当前行均线的最大偏差，超出视为另一排。缺省 300（半个吸附步长） */
  crossTol?: number;
  /** 朝向容差（deg）：偏离 0/90/180/270 超过该值的组件不参与（斜放的柜不配成排）。缺省 5 */
  rotationTol?: number;
  /** 成排最少台数，单台不叫「一排」。缺省 2 */
  minSize?: number;
}

const DEFAULTS = { maxGap: 2000, crossTol: 300, rotationTol: 5, minSize: 2 } as const;

/** 是否机柜族（有 U 位数）：与属性面板「额定功率 / 实际负载」字段的显示条件同源 */
export function isRackComponent(
  _comp: Component,
  type?: Pick<ComponentType, 'uSlots'> | null,
): boolean {
  return typeof type?.uSlots === 'number' && type.uSlots > 0;
}

/** 排标签：0 →「A 排」、25 →「Z 排」、26 →「AA 排」（Excel 列名式） */
export function rowLabel(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${s} 排`;
}

/**
 * 由朝向取排列轴向：0 / 180 → 柜列沿 X；90 / 270 → 沿 Z。
 * 偏离正交超过 tol 判为斜放（返回 null，不参与自动成排）。
 * 复用 core 的 `yawDegrees`（与属性面板 / 变换手柄同一换算），不另算一套三角函数。
 */
export function rowAxisOfRotation(
  rotation: Component['rotation'],
  tol: number = DEFAULTS.rotationTol,
): RowAxis | null {
  const norm = ((yawDegrees(rotation) % 360) + 360) % 360;
  const snapped = Math.round(norm / 90) * 90;
  const drift = Math.min(Math.abs(norm - snapped), 360 - Math.abs(norm - snapped));
  if (drift > tol) return null;
  return snapped % 180 === 0 ? 'x' : 'z';
}

/** 主轴 / 横向坐标（同一 axis 内取法固定，保证间距与行偏差各算各的） */
function coordsOf(c: Component, axis: RowAxis): { main: number; cross: number } {
  return axis === 'x'
    ? { main: c.position.x, cross: c.position.z }
    : { main: c.position.z, cross: c.position.x };
}

/** 内部：簇 + 稳定排序键（同房间内先按所在线的横向均值、再按首件主轴坐标） */
interface ScoredCluster {
  cluster: RowCluster;
  cross: number;
  main: number;
}

/**
 * 按布局自动识别排（D3「自动成排」按钮的大脑）：
 * ① 过滤候选与斜放件 → ② 按 (房间, 轴向) 分桶 → ③ 桶内按横向坐标聚成「线」
 * → ④ 线内按主轴排序、间距超上限断簇 → ⑤ 丢弃不足 minSize 的簇。
 *
 * 为什么面对背的两排不会粘成一排：它们横向（cross）相差「柜深 + 通道宽」，通常 ≥ 1200mm，
 * 远超 crossTol ⇒ 天然分成两条线，无需读朝向语义就能拆开。
 * 纯函数：不改入参；输出顺序稳定（同样输入必得同样结果 ⇒ A/B/C 命名可重复）。
 */
export function inferRowClusters(
  components: readonly Component[],
  opts: InferRowsOptions = {},
): RowCluster[] {
  const maxGap = opts.maxGap ?? DEFAULTS.maxGap;
  const crossTol = opts.crossTol ?? DEFAULTS.crossTol;
  const rotationTol = opts.rotationTol ?? DEFAULTS.rotationTol;
  const minSize = opts.minSize ?? DEFAULTS.minSize;
  const isCandidate = opts.isCandidate ?? ((c) => typeof c.attrs.ratedPowerW === 'number');

  const buckets = new Map<string, { axis: RowAxis; roomId?: string; items: Component[] }>();
  for (const c of components) {
    if (!isCandidate(c)) continue;
    const axis = rowAxisOfRotation(c.rotation, rotationTol);
    if (!axis) continue;
    const key = `${axis}|${c.roomId ?? ''}`;
    let b = buckets.get(key);
    if (!b) {
      b = { axis, roomId: c.roomId, items: [] };
      buckets.set(key, b);
    }
    b.items.push(c);
  }

  const scored: ScoredCluster[] = [];
  for (const { axis, roomId, items } of buckets.values()) {
    // ③：按横向坐标聚成「线」（累均值吸收轻微抖动，等价于一条带容差的拟合直线）
    const byCross = [...items].sort(
      (a, b) =>
        coordsOf(a, axis).cross - coordsOf(b, axis).cross ||
        coordsOf(a, axis).main - coordsOf(b, axis).main,
    );
    const lines: { crossSum: number; n: number; items: Component[] }[] = [];
    for (const c of byCross) {
      const { cross } = coordsOf(c, axis);
      const line = lines[lines.length - 1];
      if (line && Math.abs(cross - line.crossSum / line.n) <= crossTol) {
        line.items.push(c);
        line.crossSum += cross;
        line.n += 1;
      } else {
        lines.push({ crossSum: cross, n: 1, items: [c] });
      }
    }
    // ④ + ⑤：线内按主轴断簇
    for (const line of lines) {
      const inLine = [...line.items].sort(
        (a, b) => coordsOf(a, axis).main - coordsOf(b, axis).main,
      );
      let run: Component[] = [];
      const flush = (): void => {
        if (run.length >= minSize) {
          scored.push({
            cluster: { axis, roomId, componentIds: run.map((c) => c.id) },
            cross: line.crossSum / line.n,
            main: coordsOf(run[0], axis).main,
          });
        }
        run = [];
      };
      for (const c of inLine) {
        const prev = run[run.length - 1];
        if (prev && coordsOf(c, axis).main - coordsOf(prev, axis).main > maxGap) flush();
        run.push(c);
      }
      flush();
    }
  }

  return scored
    .sort((a, b) => {
      const byRoom = (a.cluster.roomId ?? '').localeCompare(b.cluster.roomId ?? '');
      if (byRoom !== 0) return byRoom;
      if (a.cluster.axis !== b.cluster.axis) return a.cluster.axis === 'x' ? -1 : 1;
      if (Math.abs(a.cross - b.cross) > 1e-6) return a.cross - b.cross;
      return a.main - b.main;
    })
    .map((s) => s.cluster);
}

/**
 * 由簇生成「排实体 + 归组关系」（T3.1 自动成排的落地产物）。
 * id 生成由调用方注入 ⇒ 单测可传固定序列断言结果，UI 侧传 `() => uid('r')`；
 * `labelFrom` 支持「已有 A/B 两排时接着编 C」，名称冲突交给 Document.addRow 自动编号兜底。
 */
export function buildRowsFromClusters(
  clusters: readonly RowCluster[],
  opts: { nextId: () => string; labelFrom?: number; labelAt?: (i: number) => string },
): { rows: RackRow[]; assignments: { rowId: string; componentIds: string[] }[] } {
  const labelAt = opts.labelAt ?? rowLabel;
  const from = opts.labelFrom ?? 0;
  const rows: RackRow[] = [];
  const assignments: { rowId: string; componentIds: string[] }[] = [];
  for (const [i, c] of clusters.entries()) {
    const row: RackRow = { id: opts.nextId(), name: labelAt(from + i) };
    if (c.roomId !== undefined) row.roomId = c.roomId;
    rows.push(row);
    assignments.push({ rowId: row.id, componentIds: [...c.componentIds] });
  }
  return { rows, assignments };
}

/** 某排的全部成员（保持入参顺序；统计与面板共用同一口径） */
export function rowMembers(components: readonly Component[], rowId: string): Component[] {
  return components.filter((c) => c.rowId === rowId);
}

/** 候选件里**没进任何排**的那批 → 统计面板的「未成排」桶（不能因为没成排就不计功率） */
export function componentsWithoutRow(
  components: readonly Component[],
  opts: { isCandidate?: (c: Component) => boolean } = {},
): Component[] {
  const isCandidate = opts.isCandidate ?? ((c) => typeof c.attrs.ratedPowerW === 'number');
  return components.filter((c) => isCandidate(c) && !c.rowId);
}

/** 排 id → 名次（面板展示与 CSV 导出排序共用；未登记的 id 不在 Map 里） */
export function rowIndexById(rows: readonly RackRow[]): Map<string, number> {
  return new Map(rows.map((r, i) => [r.id, i]));
}
