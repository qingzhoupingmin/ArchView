/**
 * LOD 档位决策（S2.5 / T2.12，产品文档 §6.2 `lod` 字段 / §10.4「日常编辑要轻盈，出图要能看」）。
 *
 * 为什么单独收口成纯函数：切档在渲染层是**全量重建组件图形**的重操作
 * （`setLodMode` → dispose 全部 entry → 重新 addOrUpdate），1000 组件下若跟着相机每帧抖，
 * 帧率会直接崩。所以「什么时候该切」必须与「怎么切」分开，且能被单测钉死。
 *
 * 阈值推算（视口 1080 高、`PerspectiveCamera` fov 50°，单位 mm）：
 *   可视高度 ≈ 2 × tan(25°) × 距离 ≈ 0.933 × 距离 ⇒ 1px ≈ 0.933 × 距离 ÷ 1080
 *   距离 6000 时 1px ≈ 5.2mm —— 正好能看清机柜 U 位横纹（10mm）与门锁（120mm）一级的细节；
 *   距离 8500 时 1px ≈ 7.3mm —— 细节件退化到亚像素，留着只白占 draw call，故退回 far。
 */
import type { LodLevel } from './types';

/**
 * 档位策略：`auto` = 按相机距离自动升降；`far` / `near` = 手动锁定。
 * 锁 far 给密集阵列保帧率，锁 near 给演示与出图（FR-V07 / V08）用。
 */
export type LodPolicy = 'auto' | 'far' | 'near';

/** 升降档距离阈值（mm，相机到 `controls.target` 的距离）；两者之间是迟滞带 */
export interface LodRule {
  /** 距离小于此值时升到 `near`（仅当当前为 `far`） */
  nearMm: number;
  /** 距离大于此值时退回 `far`（仅当当前为 `near`）；必须 ≥ nearMm */
  farMm: number;
}

export const DEFAULT_LOD_RULE: LodRule = { nearMm: 6000, farMm: 8500 };

/** 迟滞带最小宽度：防止调用方把两个阈值写成同一个值（= 边界无限抖动） */
const MIN_HYSTERESIS_MM = 500;

/** 归一化规则：保证 farMm ≥ nearMm + 迟滞带，且两值均为正有限数 */
export function normalizeLodRule(rule?: Partial<LodRule>): LodRule {
  const nearMm = Number.isFinite(rule?.nearMm) ? Math.max(0, rule!.nearMm!) : DEFAULT_LOD_RULE.nearMm;
  let farMm = Number.isFinite(rule?.farMm) ? rule!.farMm! : DEFAULT_LOD_RULE.farMm;
  if (farMm < nearMm + MIN_HYSTERESIS_MM) farMm = nearMm + MIN_HYSTERESIS_MM;
  return { nearMm, farMm };
}

/**
 * 决策下一帧应处于哪个档位。
 *
 * 迟滞（hysteresis）是这里的**核心**而不是点缀：单阈值下相机停在临界距离来回挪 1mm
 * 就会反复全量重建图形；双阈值把切换点分成「进 6m / 出 8.5m」，中间区域保持现状。
 *
 * @param policy 当前策略
 * @param distanceMm 相机到目标点距离（mm）；非有限值（正交顶视 / 相机未就绪）时保持原档
 * @param prev 上一帧档位
 * @param rule 阈值，缺省 {@link DEFAULT_LOD_RULE}
 */
export function decideLod(
  policy: LodPolicy,
  distanceMm: number,
  prev: LodLevel,
  rule: LodRule = DEFAULT_LOD_RULE,
): LodLevel {
  if (policy !== 'auto') return policy;
  if (!Number.isFinite(distanceMm)) return prev;
  const r = normalizeLodRule(rule);
  if (prev === 'near') return distanceMm > r.farMm ? 'far' : 'near';
  return distanceMm < r.nearMm ? 'near' : 'far';
}

/** 策略循环顺序（HUD chip / 快捷键 L 一个入口轮转三态） */
export const LOD_POLICY_CYCLE: LodPolicy[] = ['auto', 'near', 'far'];

/** 取下一档策略（循环） */
export function nextLodPolicy(policy: LodPolicy): LodPolicy {
  const i = LOD_POLICY_CYCLE.indexOf(policy);
  return LOD_POLICY_CYCLE[(i + 1) % LOD_POLICY_CYCLE.length];
}

/** 策略的中文短标签（状态栏 chip / 帮助表用；渲染层不碰 UI 文案，故放 core 供两侧复用） */
export function lodPolicyLabel(policy: LodPolicy): string {
  return policy === 'auto' ? '细节 自动' : policy === 'near' ? '细节 近档' : '细节 远档';
}
