/**
 * 空场景引导卡的显示判定单测（§10.3「可跳过」）。
 * T4.1 起本文件同时是「上手提示全套纯逻辑」的单测：3 步引导的步骤推进、
 * 两个「已看过」标记的持久化与互不牵连、「载入示例工程」的三道前置判定。
 *
 * 与 StatsPanel.test.tsx 同一取舍：只断言可离线跑的纯逻辑与存储读写，
 * 真正的「卡片挡不挡鼠标」是 CSS `pointer-events` 与渲染层事件绑定共同决定的，归浏览器验收。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canLoadSample,
  clearOnboardingSeen,
  emptyHintClosed,
  GUIDE_LAST_ACTION,
  GUIDE_STEPS,
  guideTargetOf,
  markEmptyHintClosed,
  markOnboardingSeen,
  nextGuideStep,
  onboardingSeen,
  prevGuideStep,
  reopenEmptyHint,
  resetOnboardingHints,
  shouldShowEmptyHint,
} from './uiHints';

/** 最小 localStorage 替身（vitest 跑在 node 环境，无 DOM） */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

describe('空场景引导卡的显示判定', () => {
  it('空工程 + 未跳过 + 未在拖拽 = 唯一显示条件', () => {
    expect(shouldShowEmptyHint({ count: 0, dismissed: false, dragging: false })).toBe(true);
  });

  it('放了组件就退场（不需要用户手动关：引导已完成使命）', () => {
    expect(shouldShowEmptyHint({ count: 1, dismissed: false, dragging: false })).toBe(false);
    expect(shouldShowEmptyHint({ count: 26, dismissed: false, dragging: false })).toBe(false);
  });

  it('点过「知道了」/ × / 画布空白后不再出现', () => {
    expect(shouldShowEmptyHint({ count: 0, dismissed: true, dragging: false })).toBe(false);
  });

  it('从组件库拖拽期间临时隐藏（卡片不许压在幽灵预览上）', () => {
    expect(shouldShowEmptyHint({ count: 0, dismissed: false, dragging: true })).toBe(false);
    // 拖拽结束（未落子）应自动回到可见——这是「临时」而非「永久」
    expect(shouldShowEmptyHint({ count: 0, dismissed: false, dragging: false })).toBe(true);
  });
});

describe('「已跳过」标记的持久化', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('无 localStorage 环境（node / 隐私模式）：读取不抛错，按「未跳过」处理', () => {
    expect(typeof localStorage).toBe('undefined');
    expect(emptyHintClosed()).toBe(false);
    expect(() => markEmptyHintClosed()).not.toThrow();
    expect(() => reopenEmptyHint()).not.toThrow();
  });

  it('写入 → 读出 true → 撤销 → 读出 false（全局记一次的闭环）', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(emptyHintClosed()).toBe(false);
    markEmptyHintClosed();
    expect(emptyHintClosed()).toBe(true);
    reopenEmptyHint();
    expect(emptyHintClosed()).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * T4.1 · 3 步上手引导（产品文档 §10.3 末段）
 * ------------------------------------------------------------------ */

describe('3 步上手引导的步骤定义', () => {
  it('正好三步，每步的标题 / 正文 / 动作按钮文案都非空（不许有空壳步骤）', () => {
    expect(GUIDE_STEPS).toHaveLength(3);
    for (const s of GUIDE_STEPS) {
      expect(s.title.trim().length).toBeGreaterThan(0);
      expect(s.body.trim().length).toBeGreaterThan(10);
      expect(s.action.trim().length).toBeGreaterThan(0);
    }
    expect(GUIDE_LAST_ACTION.trim().length).toBeGreaterThan(0);
  });

  it('三步分别指向三个不同面板：组件库 → 属性页签 → 统计页签', () => {
    expect(GUIDE_STEPS.map((s) => s.target)).toEqual(['left', 'props', 'stats']);
    expect(new Set(GUIDE_STEPS.map((s) => s.target)).size).toBe(3);
  });

  it('nextGuideStep 走到头返回 -1（-1 是「该收尾」的专用信号，不是索引）', () => {
    expect(nextGuideStep(0)).toBe(1);
    expect(nextGuideStep(1)).toBe(2);
    expect(nextGuideStep(2)).toBe(-1);
  });

  it('prevGuideStep 不越界（第一步再退还是第一步；负数不用于「上一步」）', () => {
    expect(prevGuideStep(0)).toBe(0);
    expect(prevGuideStep(2)).toBe(1);
    expect(prevGuideStep(-1)).toBe(0);
  });

  it('guideTargetOf：越界与未打开（-1）都给 null，面板才不会平白高亮', () => {
    expect(guideTargetOf(0)).toBe('left');
    expect(guideTargetOf(2)).toBe('stats');
    expect(guideTargetOf(3)).toBeNull();
    expect(guideTargetOf(-1)).toBeNull();
  });
});

describe('「载入示例工程」的前置判定（与顶栏导入工程文件同一套口径）', () => {
  it('可载入：非只读 + 已绑定后端工程', () => {
    expect(canLoadSample({ readOnly: false, hasProjectId: true })).toEqual({ ok: true });
  });

  it('只读工程（他人工程）拒绝：写了也同步不上去，只会留下一条永远同步不掉的缓冲', () => {
    const r = canLoadSample({ readOnly: true, hasProjectId: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('只读');
  });

  it('未绑定后端的草稿拒绝：没有 projectId 就没有落点', () => {
    const r = canLoadSample({ readOnly: false, hasProjectId: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('工程列表');
  });

  it('只读优先于无落点报出（两条同时命中时，先说真正堵住用户的那一条）', () => {
    const r = canLoadSample({ readOnly: true, hasProjectId: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('只读');
  });
});

describe('引导「看过了」标记', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('无 localStorage 环境：读取恒 false，写入 / 清除都不抛错', () => {
    expect(onboardingSeen()).toBe(false);
    expect(() => markOnboardingSeen()).not.toThrow();
    expect(() => clearOnboardingSeen()).not.toThrow();
  });

  it('标记独立于空场景卡片：跳过卡片不等于看过引导，反之亦然', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(onboardingSeen()).toBe(false);
    markEmptyHintClosed();
    expect(onboardingSeen()).toBe(false); // 只关了卡片
    markOnboardingSeen();
    expect(onboardingSeen()).toBe(true);
    clearOnboardingSeen();
    expect(onboardingSeen()).toBe(false);
    expect(emptyHintClosed()).toBe(true); // 卡片标记不受牵连
  });

  it('resetOnboardingHints 一次放回两个标记（只清引导会让「重新显示」看不到卡片）', () => {
    const removed: string[] = [];
    vi.stubGlobal('localStorage', {
      ...fakeStorage(),
      removeItem: (k: string) => {
        removed.push(k);
      },
    });
    resetOnboardingHints();
    expect(removed).toContain('archview.onboardingSeen');
    expect(removed).toContain('archview.emptyHintClosed');
  });
});

