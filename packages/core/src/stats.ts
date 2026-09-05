/**
 * 电力统计纯函数（T3.1 / FR-D02 + FR-A01，产品文档 §6.2 / §8.2-12）。
 *
 * 全部收在 core 的两条理由：
 * 1. **口径只能有一份**：属性面板现在自己 reduce 了一遍总功率（且读的是 `ratedPowerW ?? powerW`，
 *    把「额定」与「设备功耗」混在一起），与将要上线的统计面板必然对不上账；
 * 2. 统计数字是 M1 演示脚本的验收项（「填功率 → 面板显示总功率 / 利用率」），
 *    必须能用黄金样例做数值断言回归（§7.2），而不是挂在 React 组件里靠肉眼。
 *
 * 范围纪律：本卡只做电力（T3.1 卡片原文）。U 位 / 制冷 / 面积统计属 FR-A02~A04 = T6.4（P3），
 * 不在此顺手加，免得造出无人消费的字段。
 */
import type { DocChange, Document } from './document';
import type { Component, ComponentType, Project } from './types';

/**
 * 额定功率字段：机柜族用 `ratedPowerW`（`it-net-rack` 等 1u/2u/4u 设备用 `powerW`）。
 * 二者不并存（实测：53 型里 `ratedPowerW` 只出现在机柜族，`powerW` 只出现在非机柜族）。
 */
const RATED_KEYS = ['ratedPowerW', 'powerW'] as const;
/** 实际负载字段：机柜族填 `actualLoadW`；无额定/负载之分的设备，其 `powerW` 本身就是负载 */
const LOAD_KEYS = ['actualLoadW', 'powerW'] as const;

/** 属性值容错：JSON 里可能是字符串 / null / NaN，一律收成有限非负数（负功率无物理意义） */
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function firstNumber(
  comp: Component,
  type: Pick<ComponentType, 'defaultAttrs'> | undefined,
  keys: readonly string[],
): number {
  for (const k of keys) {
    const v = num(comp.attrs[k]);
    if (v > 0) return v;
  }
  for (const k of keys) {
    const v = num(type?.defaultAttrs?.[k]);
    if (v > 0) return v;
  }
  return 0;
}

/**
 * 单台额定功率（W）：实例值优先 → 类型默认值 → 0。
 * 实例优先是 FR-D01 的既有约定（属性面板改的是实例 attrs，不动类型）。
 */
export function ratedPowerW(
  comp: Component,
  type?: Pick<ComponentType, 'defaultAttrs'>,
): number {
  return firstNumber(comp, type, RATED_KEYS);
}

/**
 * 单台实际负载（W）。`actualLoadW` 缺失时回退 `powerW`（非机柜设备的功耗即其负载），
 * 仍取不到则为 **0 且计入 `unmeasured`**——见 `PowerTotals.unmeasured` 的注释，
 * 「没填」绝不能伪装成「省电」，否则演示脚本里会出现一片漂亮的低利用率。
 */
export function loadPowerW(
  comp: Component,
  type?: Pick<ComponentType, 'defaultAttrs'>,
): number {
  return firstNumber(comp, type, LOAD_KEYS);
}

/** 该件是否「填过实际负载」：决定它进不进 unmeasured 计数 */
export function hasMeasuredLoad(comp: Component): boolean {
  return num(comp.attrs.actualLoadW) > 0 || num(comp.attrs.powerW) > 0;
}

/** 一组组件的电力合计 */
export interface PowerTotals {
  /** 参与统计的组件台数 */
  count: number;
  /** 额定功率合计（W） */
  ratedW: number;
  /** 实际负载合计（W） */
  loadW: number;
  /** 未填实际负载的台数（面板须显式提示，不能让「没填」冒充「省电」） */
  unmeasured: number;
  /**
   * 负载率 = loadW / ratedW。**额定合计为 0 时是 null 而非 0**：
   * 「一批没标额定功率的设备」与「空机房满载 0%」是两件完全不同的事，混成一个 0 会误导决策。
   */
  loadRate: number | null;
}

/** 空合计（复用同一份语义，免得各处手写零值） */
export function emptyPower(): PowerTotals {
  return { count: 0, ratedW: 0, loadW: 0, unmeasured: 0, loadRate: null };
}

/** 由额定 / 负载 / 台数装配一项合计（三级聚合共用同一个收尾，保证比率口径一致） */
export function makePower(count: number, ratedW: number, loadW: number, unmeasured: number): PowerTotals {
  return {
    count,
    ratedW,
    loadW,
    unmeasured,
    loadRate: ratedW > 0 ? loadW / ratedW : null,
  };
}

/** 一组组件的电力合计（typeOf 用于回退类型默认值；签名按 typeId 取，与 doc.getType 一致） */
export function powerTotals(
  components: readonly Component[],
  typeOf?: (typeId: string) => ComponentType | undefined,
): PowerTotals {
  let ratedW = 0;
  let loadW = 0;
  let unmeasured = 0;
  for (const c of components) {
    const t = typeOf?.(c.typeId);
    ratedW += ratedPowerW(c, t);
    loadW += loadPowerW(c, t);
    if (!hasMeasuredLoad(c)) unmeasured += 1;
  }
  return makePower(components.length, ratedW, loadW, unmeasured);
}

/** 单台明细（面板展开到柜级用；FR-A01「列表」的最细一层） */
export interface UnitPower {
  id: string;
  name: string;
  ratedW: number;
  loadW: number;
  /** false ⇒ 这台柜的 0 负载是「没填」，不是「真的省电」——面板与 CSV 都要能区分 */
  measured: boolean;
}

/** 一排的电力；`rowId === null` 是「未成排」聚合桶（不能因为没成排就不计功率） */
export interface RowPower extends PowerTotals {
  rowId: string | null;
  /** 排名；未成排桶固定用 UNASSIGNED_ROW_NAME */
  name: string;
  units: UnitPower[];
}

/** 未成排桶的名字（面板与 CSV 共用同一份，别两处各写一个字面量） */
export const UNASSIGNED_ROW_NAME = '未成排';

/** 工程级电力统计结果 */
export interface ProjectPower {
  /** 机房总计（= 全部有功率字段的组件，含未成排与非机柜设备：空调与照明确实在耗电） */
  project: PowerTotals;
  /** 排级列表：按 Project.rows 数组顺序；有未成排成员时追加一条 rowId=null 在末尾 */
  rows: RowPower[];
  /** 机柜台数（有 U 位数的组件）——面板「N 台机柜 / M 个组件」口径 */
  rackCount: number;
  /** 工程内组件总数 */
  componentCount: number;
}

/** 是否机柜族（有 U 位数）：与 row.isRackComponent 同口径，两处必须一起改 */
export function isRackUnit(
  _comp: Component,
  type?: Pick<ComponentType, 'uSlots'> | null,
): boolean {
  return typeof type?.uSlots === 'number' && type.uSlots > 0;
}

/** 组件级明细列表（按入参顺序） */
export function powerUnits(
  components: readonly Component[],
  typeOf?: (typeId: string) => ComponentType | undefined,
): UnitPower[] {
  return components.map((c) => {
    const ratedW = ratedPowerW(c, typeOf?.(c.typeId));
    const loadW = loadPowerW(c, typeOf?.(c.typeId));
    return { id: c.id, name: c.name, ratedW, loadW, measured: hasMeasuredLoad(c) };
  });
}

/** 一组组件 → 一台排的合计（含柜级明细） */
export function rowPower(
  rowId: string | null,
  name: string,
  components: readonly Component[],
  typeOf?: (typeId: string) => ComponentType | undefined,
): RowPower {
  const units = powerUnits(components, typeOf);
  let ratedW = 0;
  let loadW = 0;
  let unmeasured = 0;
  for (const u of units) {
    ratedW += u.ratedW;
    loadW += u.loadW;
    if (!u.measured) unmeasured += 1;
  }
  return { rowId, name, units, ...makePower(units.length, ratedW, loadW, unmeasured) };
}

/**
 * 工程级三级汇总（FR-A01：机房 / 排 / 机柜）。
 * 纯函数、无缓存——需要增量的调用方用 `createPowerIndex` 包一层。
 */
export function summarizeProject(
  project: Pick<Project, 'components' | 'rows'>,
  typeOf?: (typeId: string) => ComponentType | undefined,
): ProjectPower {
  const byRow = new Map<string | null, Component[]>();
  let rackCount = 0;
  for (const c of project.components) {
    const t = typeOf?.(c.typeId);
    if (isRackUnit(c, t)) rackCount++;
    const key = c.rowId ?? null;
    const list = byRow.get(key);
    if (list) list.push(c);
    else byRow.set(key, [c]);
  }
  const rows: RowPower[] = project.rows.map((r) =>
    rowPower(r.id, r.name, byRow.get(r.id) ?? [], typeOf),
  );
  const loose = byRow.get(null);
  // 未成排桶只在「真有成员」时出现；且成员仅限机柜族以外的判断交给面板，此处如实汇总全部散件
  if (loose && loose.length > 0) {
    rows.push(rowPower(null, UNASSIGNED_ROW_NAME, loose, typeOf));
  }
  return {
    project: powerTotals(project.components, (typeId) => typeOf?.(typeId)),
    rows,
    rackCount,
    componentCount: project.components.length,
  };
}

/** Document 的最小依赖面：只取工程数据与订阅，stats 不反向依赖 Document 的实现细节 */
type DocLike = Pick<Document, 'project' | 'subscribe' | 'getComponent'>;

/** 索引观测值（仅测试与调试消费：用来证明记忆化真的在省钱） */
export interface PowerIndexStats {
  /** 排桶重算次数 */
  rowRecomputes: number;
  /** 全量重建次数 */
  fullRebuilds: number;
}

/** 电力统计索引的对外接口（生命周期与被索引的 Document 一致，见 useDocumentStore） */
export interface PowerIndex {
  /** 当前统计（惰性求值 + 按排桶增量重算） */
  get(): ProjectPower;
  /** 解除 Document 订阅 */
  dispose(): void;
  /** 重算探针（仅测试与调试消费） */
  readonly stats: PowerIndexStats;
}

/**
 * 电力统计索引（T3.1「记忆化」的落点）：把 `summarizeProject` 包成按排桶增量重算的缓存。
 *
 * 为什么值得单独一层：面板每次改一台柜的功率都要刷新数字，1000 组件工程若每次都全量重算，
 * 就是每键一次扫 1000×attrs（还带类型默认值回退）。这里把「分组」与「算功率」分开——
 * 分组每轮必做（O(n) 纯引用比较，不读属性），**只有脏桶才真正算功率**。
 *
 * 关键细节是 `unitRow` 映射：组件被删除后就从 `components` 里消失了，问不出它原来属于哪一排，
 * 故记下「上次计算时每个组件所属的排」，靠它找回旧桶；换排时新旧两个桶一起标脏。
 *
 * 前提：变更一律经 Command（§8.2-1 的既有架构决策），否则未通知的直改不会触发失效。
 */
export function createPowerIndex(
  doc: DocLike,
  typeOf?: (typeId: string) => ComponentType | undefined,
): PowerIndex {
  const stats: PowerIndexStats = { rowRecomputes: 0, fullRebuilds: 0 };
  const bucket = new Map<string | null, RowPower>();
  const rackCountOf = new Map<string | null, number>();
  const unitRow = new Map<string, string | null>();
  const dirty = new Set<string | null>();
  let fullDirty = true;

  const recompute = (rowId: string | null, name: string, comps: Component[]): RowPower => {
    stats.rowRecomputes++;
    let racks = 0;
    for (const c of comps) {
      unitRow.set(c.id, rowId);
      if (isRackUnit(c, typeOf?.(c.typeId))) racks++;
    }
    rackCountOf.set(rowId, racks);
    return rowPower(rowId, name, comps, typeOf);
  };

  const unsubscribe = doc.subscribe((_d, change: DocChange) => {
    // 工程整体替换：一切推倒
    if (change.type === 'project') {
      fullDirty = true;
      return;
    }
    // undo / redo 发的是「空 ids」（改了什么不知道）且不带 rowIds → 只能全量重建
    if (change.componentIds.length === 0 && !(change.rowIds?.length ?? 0)) {
      fullDirty = true;
      return;
    }
    for (const id of change.componentIds) {
      const prev = unitRow.get(id);
      if (prev !== undefined) dirty.add(prev); // 删除 / 移出的旧桶
      const c = doc.getComponent(id);
      if (c) dirty.add(c.rowId ?? null); // 移入 / 新增的新桶
    }
    // 排实体自身变化（改名 / 删除）：成员通知可能缺席（removeRow 只发 rowIds），故按 rowIds 兜底
    if (change.rowIds?.length) {
      for (const rid of change.rowIds) dirty.add(rid);
      dirty.add(null); // 排被删后其成员落入未成排桶
    }
    // 房间变更不参与电力统计，无需失效（roomIds 刻意不处理）
  });

  const get = (): ProjectPower => {
    const { components, rows } = doc.project;
    if (fullDirty) {
      stats.fullRebuilds++;
      bucket.clear();
      rackCountOf.clear();
      unitRow.clear();
      dirty.clear();
      fullDirty = false;
    }
    // ① 分组（每轮必做：只是引用比较级别的开销，不读 attrs）
    const groups = new Map<string | null, Component[]>();
    for (const c of components) {
      const key = c.rowId ?? null;
      const list = groups.get(key);
      if (list) list.push(c);
      else groups.set(key, [c]);
    }
    // ② 逐桶：非脏直接复用缓存，脏桶才重算功率
    const list: RowPower[] = [];
    let rackCount = 0;
    const take = (key: string | null, name: string): RowPower => {
      const comps = groups.get(key) ?? [];
      let rp = bucket.get(key);
      if (!rp || dirty.has(key) || rp.name !== name) {
        rp = recompute(key, name, comps);
        bucket.set(key, rp);
        dirty.delete(key);
      }
      rackCount += rackCountOf.get(key) ?? 0;
      return rp;
    };
    for (const r of rows) list.push(take(r.id, r.name));
    const loose = groups.get(null);
    if (loose && loose.length > 0) list.push(take(null, UNASSIGNED_ROW_NAME));
    // ③ 机房总计从排桶合并得出（O(桶数)），与 summarizeProject 口径完全一致
    let ratedW = 0;
    let loadW = 0;
    let unmeasured = 0;
    let count = 0;
    for (const rp of list) {
      count += rp.count;
      ratedW += rp.ratedW;
      loadW += rp.loadW;
      unmeasured += rp.unmeasured;
    }
    return {
      project: makePower(count, ratedW, loadW, unmeasured),
      rows: list,
      rackCount,
      componentCount: components.length,
    };
  };

  return {
    get,
    dispose: () => unsubscribe(),
    get stats() {
      return stats;
    },
  };
}
