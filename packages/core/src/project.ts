/**
 * 工程级纯工具（T2.11 / 产品文档 §6.5）。
 * 收口在 core，让「载入已存工程」（web）与「载入黄金样例」（component-lib）走同一份
 * 合并语义，避免两处各写一遍造成内置素材表现漂移。
 */
import type { Component, ComponentType, Project, RackRow } from './types';

/** 迁移入参：rows 字段可缺（= T3.1 之前存盘的旧工程），其余字段照旧 */
export type LegacyProject = Omit<Project, 'rows'> & Partial<Pick<Project, 'rows'>>;

/**
 * 用内置组件库**刷新**工程里已有的类型（几何以库为准，不追加缺失类型）。
 *
 * 为什么要刷新：工程文件按 P1 约定把「用到的类型」连同 `geometry` 一起存盘（FR-I01），
 * 于是内置素材在 T2.11 精修之后，**旧工程与黄金样例里存盘的仍是旧灰盒几何**。
 *
 * 为什么刷新是安全的：属性面板可编辑的是**实例**的 `color` / `size` / `attrs`（FR-D01 / D05），
 * 从不可编辑 `type.geometry`；因此「ID 命中内置库 ⇒ 该类型必是内置类型」，几何以库为准零损失。
 * ID 不在内置库里的条目视为用户自定义类型，原样保留（§12 社区轨扩展点）。
 */
export function refreshBuiltinTypes(
  projectTypes: readonly ComponentType[] | undefined,
  builtinTypes: readonly ComponentType[],
): ComponentType[] {
  const builtin = new Map(builtinTypes.map((t) => [t.id, t]));
  const kept: ComponentType[] = [];
  const seen = new Set<string>();
  for (const t of projectTypes ?? []) {
    if (seen.has(t.id)) continue; // 存盘重复 ID 去重，否则组件库面板出现双份卡片
    seen.add(t.id);
    kept.push(builtin.get(t.id) ?? t);
  }
  return kept;
}

/**
 * 载入工程时的完整类型对齐 = **刷新内置几何** + **补齐缺失的内置类型**（T2.9 / T2.11）。
 *
 * 补齐的意义：旧工程若缺新增预置组件，放置时 `doc.getType` 会落空并静默失败。
 * 顺序语义：保留工程原有次序（影响面板展示次序），库中新增的类型追加在后。
 * 纯函数：不改动入参。
 */
export function alignBuiltinTypes(
  projectTypes: readonly ComponentType[] | undefined,
  builtinTypes: readonly ComponentType[],
): ComponentType[] {
  const kept = refreshBuiltinTypes(projectTypes, builtinTypes);
  const seen = new Set(kept.map((t) => t.id));
  for (const t of builtinTypes) {
    if (!seen.has(t.id)) kept.push(t);
  }
  return kept;
}

/**
 * 清洗排数组：非对象 / 无 id / id 重复的一律丢弃，字段只保留 { id, roomId?, name }。
 * 目的是「外部 JSON 再脏，进了 Document 就只会是合法 RackRow」，让统计层无需到处判空。
 */
function normalizeRows(input: unknown): RackRow[] {
  if (!Array.isArray(input)) return [];
  const out: RackRow[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Partial<RackRow>;
    if (typeof r.id !== 'string' || r.id === '' || seen.has(r.id)) continue;
    seen.add(r.id);
    const row: RackRow = { id: r.id, name: typeof r.name === 'string' ? r.name : '' };
    if (typeof r.roomId === 'string') row.roomId = r.roomId;
    out.push(row);
  }
  return out;
}

/**
 * 工程载入迁移（T3.1 / FR-I01，产品文档 §8.2-12）：**所有** Project 进入 Document 前的唯一入口。
 *
 * 为什么 `Project.rows` 是必填却不升 `schemaVersion`：新增可补齐的加法式字段属兼容变更，
 * 而 §6.2 既定的升版触发条件是「引入 gltf 引用」这类破坏性变更。旧工程（含线上已存的
 * 4 个工程与 IndexedDB 崩溃缓冲）缺 `rows` 时在此补 `[]`，语义等价、零数据损失。
 *
 * 顺手兜掉两类脏数据：① 排 id 重复；② 成员 rowId 悬空（排已不存在）——悬空引用若不清，
 * 统计会把同一台柜既算进「已删的排」又算进「未成排」，数值对不上账。
 * 纯函数：不改入参；无需变更时复用原数组引用（载入 1000 组件工程不至于多跑一遍深拷贝）。
 */
export function migrateProject(project: LegacyProject): Project {
  const rows = normalizeRows(project.rows);
  const validIds = new Set(rows.map((r) => r.id));
  // 服务端 dataJson 是任意 JSON（集成测试里就存过 `{ schemaVersion, secret }` 这种残缺对象），
  // 缺 components 时补空数组，而不是让 Document 在 undefined 上崩。
  // 完整结构校验（rooms / types / 每个组件字段）属 T3.4 的 .archview 解析职责，此处不扩张。
  const source: Component[] = Array.isArray(project.components) ? project.components : [];
  let components = source;
  if (source.some((c) => c?.rowId && !validIds.has(c.rowId))) {
    components = source.map((c) => {
      if (!c.rowId || validIds.has(c.rowId)) return c;
      const copy: Component = { ...c };
      delete copy.rowId;
      return copy;
    });
  }
  return { ...project, rows, components };
}
