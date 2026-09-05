/**
 * LOD 双档控制器（架构拆分 Phase 3，自 `viewport.ts` 逐字迁出，T2.12）
 *
 * 只负责「档位状态 + 何时该换档」，**不负责换档的代价**：图元集合随档位变化，
 * 真切换时要重建全场景图形，那件事由门面通过 `LodHost.rebuildAll()` 回调完成
 * （重建还牵扯描边与选择集，属于跨块编排，不该藏在这里）。
 */
import {
  decideLod,
  DEFAULT_LOD_RULE,
  normalizeLodRule,
  type LodLevel,
  type LodPolicy,
  type LodRule,
} from '@archview/core';
import { LOD_CHECK_INTERVAL_MS } from './constants';
import type { ViewMode } from './types';

export interface LodHost {
  /** 全场景图形重建（LOD 升降档 = 图元集合变化） */
  rebuildAll(): void;
  /** 档位实际变化上报应用层（状态栏 chip） */
  onLod(mode: LodLevel): void;
  /** 当前观察距离（mm）；2D 正交顶视无距离概念，返回 Infinity */
  distance(): number;
  /** 当前视图模式：2D 恒 far（细节件在顶视只会多建面、糊尺寸线） */
  viewMode(): ViewMode;
}

export class LodController {
  private readonly host: LodHost;
  /** 当前 LOD 档位（T2.12）：far = 常规编辑视口，near = 近景 / 漫游 / 出图 */
  private modeNow: LodLevel = 'far';
  /** 升降档策略（T2.12）：auto = 按相机距离；far / near = 手动锁定（密集阵列保帧率 / 出图保细节） */
  private policy: LodPolicy = 'auto';
  /** 升降档阈值（mm），由 `setRule` 覆盖；构造时已归一化 */
  private rule: LodRule = DEFAULT_LOD_RULE;
  /** 上一次 LOD 距离检测时间戳（T2.12）：切档是全量重建，故只按节拍检测，不逐帧 */
  private lastCheckAt = 0;

  constructor(host: LodHost) {
    this.host = host;
  }

  /** 当前实际渲染的档位（供应用层显示与单测断言） */
  get mode(): LodLevel {
    return this.modeNow;
  }

  /** 当前升降档策略（`auto` / `far` / `near`） */
  get currentPolicy(): LodPolicy {
    return this.policy;
  }

  get currentRule(): LodRule {
    return this.rule;
  }

  /**
   * 切换 LOD 档位（底层入口）：图元集合随档位变化，故**重建全部组件图形**；选择集与机位保持不变。
   * 平时走 `setPolicy`（带锁定语义）；本方法供 `withForced` 出图升档与单测直接调用。
   */
  setMode(mode: LodLevel): void {
    if (mode === this.modeNow) return;
    this.modeNow = mode;
    this.host.rebuildAll();
    // 手动设档后把下次自动检测推后一个节拍，避免「刚升上去就被距离判定拉回来」的打架
    this.lastCheckAt = performance.now();
    this.host.onLod(mode);
  }

  /** 设策略并立即生效一次（不必等下个检测节拍） */
  setPolicy(policy: LodPolicy): void {
    this.policy = policy;
    this.apply(this.targetNow());
  }

  /** 覆盖升降档阈值（mm）；退档线自动保证 ≥ 升档线 + 迟滞带（`normalizeLodRule`） */
  setRule(rule: Partial<LodRule>): void {
    this.rule = normalizeLodRule(rule);
    if (this.policy === 'auto') this.apply(this.targetNow());
  }

  /** 按当前策略 / 视角 / 距离算出「本帧应在哪个档」（决策在 core `decideLod`，此处只供料） */
  targetNow(): LodLevel {
    // 2D 顶视看的是占地轮廓，near 细节件只会多建面、糊尺寸线，故恒 far（切回 3D 由策略自动恢复）
    if (this.host.viewMode() !== '3d') return 'far';
    return decideLod(this.policy, this.host.distance(), this.modeNow, this.rule);
  }

  apply(target: LodLevel): void {
    if (target !== this.modeNow) this.setMode(target);
  }

  /**
   * 每帧调用，但按 `LOD_CHECK_INTERVAL_MS` 节拍才真检测（T2.12）：
   * 切档是全量重建，逐帧判定等于把相机推拉变成逐帧重建；迟滞带另保证边界不来回抖。
   */
  tick(now: number): void {
    if (now - this.lastCheckAt < LOD_CHECK_INTERVAL_MS) return;
    this.lastCheckAt = now;
    this.apply(this.targetNow());
  }

  /**
   * **出图升档**（FR-V07 截图 / FR-V05 漫游 / FR-V08 视频的接线口，§10.4「日常编辑要轻盈，出图要能看」）：
   * 临时把全场景升到指定档 → 同步执行 `fn`（内部 render + `toBlob` 即可拿到含细节的图）→
   * `finally` 无条件恢复原档位，编辑视口的帧率预算不受出图影响。
   */
  withForced<T>(mode: LodLevel, fn: () => T): T {
    const prev = this.modeNow;
    this.setMode(mode);
    try {
      return fn();
    } finally {
      this.setMode(prev);
    }
  }
}