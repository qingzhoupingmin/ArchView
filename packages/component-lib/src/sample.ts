/**
 * 标准机房样例（T0.9 / S2.0b，产品文档附录 A）。
 * 静态数据：固定 ID + 固定种子负载（seed 20260901，LCG），保证可回归。
 * 下游依赖：Sprint 3 统计回归基线（§7.2 黄金样例）/ T3.6 性能基线 / T4.1「载入示例工程」/ 沙盒默认载入。
 */
import type { LegacyProject, Project } from '@archview/core';
import { migrateProject, refreshBuiltinTypes } from '@archview/core';
import raw from '../data/sample/standard-room.json';
import { componentTypes } from './index';

/**
 * 载入标准机房样例（深拷贝：两次载入互不影响，源数据不被消费方污染）。
 *
 * T2.11：存盘的 `types[]` 是**几何快照**，必须按内置组件库刷新后再交付——
 * 否则样例永远显示 T2.9 那批灰盒，M1 演示脚本、`/fps` 基线与「载入示例工程」
 * 全都看不到素材精修的效果。只刷新、不补齐 53 型（保持 P1「工程只存用到的类型」的轻量约定）。
 *
 * T3.1：样例 JSON 存盘于「排」概念之前、没有 `rows` 字段，故同样要过 `migrateProject`——
 * 它是**黄金样例统计断言的基线**，缺这一行会让 stats 层在 `undefined` 上找排。
 */
export function loadSampleProject(): Project {
  const project = migrateProject(JSON.parse(JSON.stringify(raw)) as LegacyProject);
  project.types = refreshBuiltinTypes(project.types, componentTypes);
  return project;
}
