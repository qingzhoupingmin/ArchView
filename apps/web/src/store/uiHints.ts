/**
 * 画布浮层提示的「已跳过」偏好（产品文档 §10.3「新手引导（空状态）… 可跳过」的实现口径）。
 *
 * 为什么单独一个模块、而不是塞进 useAppStore：
 * - `useAppStore` 装的是**本次会话内**的 UI 状态，且登出 / 切账号时 `resetSessionScoped()` 要复位它；
 *   而「这条通用教学文案我看过了」是跨工程、跨账号的界面偏好——复位它反而不对
 *   （数据隔离专项口径：视图偏好跨账号沿用，不进 teardown）。
 * - 显示判定抽成纯函数 `shouldShowEmptyHint`，可在 node 环境直接单测；
 *   Viewport 本体挂 three.js，不适合做 DOM 渲染测试（同 StatsPanel.test 的取舍）。
 *
 * localStorage 读写一律 try/catch：隐私模式会抛，node（vitest `environment: 'node'`）里
 * `localStorage` 未定义同样抛 ReferenceError——两种情况都退化成「不持久化，本次会话内仍可关闭」，
 * 与 useThemeStore 同一范式。
 */

/** 关闭标记的 key（值恒为 '1'；不存在 = 从未关闭过） */
const LS_EMPTY_HINT_CLOSED = 'archview.emptyHintClosed';

/** 空场景引导卡是否已被用户跳过（跨会话；无法持久化时恒 false） */
export function emptyHintClosed(): boolean {
  try {
    return localStorage.getItem(LS_EMPTY_HINT_CLOSED) === '1';
  } catch {
    return false;
  }
}

/** 记住「已跳过」：全局一次即可，之后任何工程都不再弹（引导文案与具体工程无关） */
export function markEmptyHintClosed(): void {
  try {
    localStorage.setItem(LS_EMPTY_HINT_CLOSED, '1');
  } catch {
    /* 无法持久化时仅本次会话生效 */
  }
}

/** 撤销「已跳过」（留给帮助弹窗的「重新显示画布引导」入口，T4.1 用） */
export function reopenEmptyHint(): void {
  try {
    localStorage.removeItem(LS_EMPTY_HINT_CLOSED);
  } catch {
    /* 忽略：清不掉就不清，下次进画布仍然不弹 */
  }
}

/** 空场景引导卡的显示判定（纯函数，单测覆盖四条分支） */
export function shouldShowEmptyHint(s: {
  /** 当前组件数：> 0 说明已经上手，引导没有存在意义 */
  count: number;
  /** 是否已被跳过（含 localStorage 读出的初始值） */
  dismissed: boolean;
  /** 正在从组件库拖拽：卡片压在幽灵预览上会挡住落点判断，临时隐藏 */
  dragging: boolean;
}): boolean {
  return s.count === 0 && !s.dismissed && !s.dragging;
}

/* ------------------------------------------------------------------ *
 * T4.1 · 3 步上手引导（产品文档 §10.3「新手引导（空状态）」末段）
 * ------------------------------------------------------------------ */

/** 「引导看过了」标记的 key：与空场景卡片各自独立，跳过卡片不等于看过引导，反之亦然 */
const LS_GUIDE_SEEN = 'archview.onboardingSeen';

/** 是否已经走完 / 跳过过 3 步引导（用于空场景卡片上那颗按钮的文案，跨会话记一次） */
export function onboardingSeen(): boolean {
  try {
    return localStorage.getItem(LS_GUIDE_SEEN) === '1';
  } catch {
    return false;
  }
}

/** 记一次「看过了」：走完最后一步或点「跳过」都算，不该第二次强拆用户的工作流 */
export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(LS_GUIDE_SEEN, '1');
  } catch {
    /* 无法持久化时仅本次会话生效 */
  }
}

/** 清掉「引导看过了」（「重新显示上手引导」用；与 `reopenEmptyHint()` 各管一个 key，互不牵连） */
export function clearOnboardingSeen(): void {
  try {
    localStorage.removeItem(LS_GUIDE_SEEN);
  } catch {
    /* 清不掉就不清，下次进画布仍然不弹 */
  }
}

/**
 * 一键重放整套上手提示（帮助弹窗那颗「重新显示上手引导」走的就是它）：
 * v3.5 先把 `reopenEmptyHint()` 留好了坑，T4.1 一起接上——只清引导标记的话，
 * 用户点完「重新显示」会看到一个连卡片都没有的画布，引导入口反而消失了。
 */
export function resetOnboardingHints(): void {
  clearOnboardingSeen();
  reopenEmptyHint();
}


/** 引导步骤的目标面板：高亮 + 「带我过去」的动作都按这个键来 */
export type GuideTarget = 'left' | 'props' | 'stats';

/**
 * 三步内容（逐字对齐产品文档 §10.3：① 组件库拖入机柜 ② 属性面板填尺寸与功率
 * ③ 统计面板看电力汇总）。文案里点的每个按钮 / 页签都必须真实存在，
 * 否则引导本身就成了误导。
 */
export interface GuideStep {
  /** 短标题（步骤条与弹窗标题用） */
  title: string;
  /** 正文（一句做什么 + 一句为什么） */
  body: string;
  /** 本步指向的面板 */
  target: GuideTarget;
  /** 「带我过去」按钮文案 */
  action: string;
}

export const GUIDE_STEPS: readonly GuideStep[] = [
  {
    title: '放一个机柜',
    body: '在左侧组件库点一下「IT 机柜 42U」，机柜就落在光标处；也可以直接拖进画布。落点自动吸附 600mm 网格，随时能用 Ctrl+Z 撤回。',
    target: 'left',
    action: '打开组件库',
  },
  {
    title: '填尺寸与功率',
    body: '点选画布上的机柜，在右栏「属性」页签改宽 / 深 / 高与旋转，并把额定功率、实际负载填上——统计只认这两个数，不填的台数会被单独计入「未填」。',
    target: 'props',
    action: '打开属性页签',
  },
  {
    title: '看电力汇总',
    body: '切到右栏「统计」页签，机房 → 排 → 机柜三级汇总与功率条都在这里；点机柜名还能联动选中画布上那一台。',
    target: 'stats',
    action: '打开统计页签',
  },
];

/** 最后一步的确认按钮文案（与前两步的「下一步」区分开，让用户知道走完了） */
export const GUIDE_LAST_ACTION = '完成，开始使用';

/** 下一步：越界（最后一步再点）返回 -1 表示「该收尾了」 */
export function nextGuideStep(step: number): number {
  return step + 1 >= GUIDE_STEPS.length ? -1 : step + 1;
}

/** 上一步：第一步保持第一步（不越界成负数，负数在本模块里是「结束」的专用语义） */
export function prevGuideStep(step: number): number {
  return step > 0 ? step - 1 : 0;
}

/** 本步指向哪个面板；越界返回 null（组件不必知道步数上限，问它就对了） */
export function guideTargetOf(step: number): GuideTarget | null {
  return GUIDE_STEPS[step]?.target ?? null;
}

/**
 * 「载入示例工程」的前置判定（纯函数，与 TopBar 导入工程文件同一套防护口径）：
 * ① 只读工程（他人工程）不能改——写了也同步不上去，只会留下一条永远同步不掉的本地缓冲；
 * ② 未绑定后端的草稿不能载——没有 projectId 就没有落点；
 * ③ 当前工程非空时需要用户二次确认（载入不可撤销，见 store/useDocumentStore.loadProject）。
 */
export function canLoadSample(s: { readOnly: boolean; hasProjectId: boolean }): {
  ok: boolean;
  reason?: string;
} {
  if (s.readOnly) return { ok: false, reason: '他人工程为只读，不能载入示例工程' };
  if (!s.hasProjectId) return { ok: false, reason: '请先从工程列表打开一个工程，再载入示例' };
  return { ok: true };
}

