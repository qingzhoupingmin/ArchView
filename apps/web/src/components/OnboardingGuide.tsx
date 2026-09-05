import { useEffect } from 'react';
import { Icon } from '@archview/ui';
import { registerOverlay, unregisterOverlay } from '../overlays';
import { useAppStore } from '../store/useAppStore';
import {
  GUIDE_LAST_ACTION,
  GUIDE_STEPS,
  guideTargetOf,
  markOnboardingSeen,
  nextGuideStep,
  prevGuideStep,
} from '../store/uiHints';

/**
 * 3 步上手引导（T4.1 / 产品文档 §10.3「新手引导（空状态）」末段）。
 *
 * 为什么是**非模态浮层**而不是 Dialog：这三步要用户真的去动手（拖组件、填功率、切页签），
 * 模态遮罩会把左右两个面板一起糊住——引导就变成了「看着说明书想象怎么做」。
 * 因此它压在画布下沿居中，两侧面板与画布都可正常操作，同时仍然 `registerOverlay()`：
 * Esc 优先关本引导而不清空选择集（§10.3 三层 Esc 语义，与弹窗 / 2D 右键菜单同一套）。
 *
 * 步骤状态取自 `useAppStore.guideStep`（null = 未打开），「是否看过」走 `store/uiHints`
 * 的 localStorage：跨会话记一次，重看入口在快捷键帮助弹窗。
 */

/* ============================ 展示层 ============================ */

/**
 * 展示层：只认 props，不碰 store。
 * 拆出来的理由是**可测**而非美观：`renderToStaticMarkup` 下 zustand 的 useSyncExternalStore
 * 走的是 server snapshot（永远返回 store 初始值），容器组件在单测里根本读不到测试设进去的步数；
 * 把渲染剥成纯 props 组件后，三步的高亮 / 按钮齐不齐这些判定就能离线钉死。
 */
export function GuidePanel({
  step,
  onSkip,
  onPrev,
  onNext,
  onGo,
}: {
  step: number;
  onSkip: () => void;
  onPrev: () => void;
  onNext: () => void;
  onGo: () => void;
}) {
  const sc = GUIDE_STEPS[step];
  if (!sc) return null; // 步数越界（理论上到不了，兜个空防白屏）
  const last = GUIDE_STEPS.length - 1;
  return (
    <div className="onboard" role="dialog" aria-label={`上手引导 第 ${step + 1} 步`}>
      <button
        type="button"
        className="onboard-close"
        title="跳过引导（可在「帮助」里重新显示）"
        aria-label="跳过引导"
        onClick={onSkip}
      >
        <Icon name="close" size={14} />
      </button>
      <ol className="onboard-steps">
        {GUIDE_STEPS.map((s, i) => (
          <li
            key={s.title}
            className={
              'onboard-step' +
              (i === step ? ' onboard-step-cur' : i < step ? ' onboard-step-done' : '')
            }
          >
            <span className="onboard-no">{i < step ? '✓' : i + 1}</span>
            <span className="onboard-step-title">{s.title}</span>
          </li>
        ))}
      </ol>
      <p className="onboard-body">{sc.body}</p>
      <div className="onboard-actions">
        <button type="button" className="btn btn-ghost" onClick={onSkip}>
          跳过
        </button>
        {step > 0 && (
          <button type="button" className="btn" onClick={onPrev}>
            上一步
          </button>
        )}
        <button type="button" className="btn" onClick={onGo}>
          {sc.action}
        </button>
        <button type="button" className="btn btn-primary" onClick={onNext}>
          {step === last ? GUIDE_LAST_ACTION : '下一步'}
        </button>
      </div>
    </div>
  );
}

/* ============================ 容器 ============================ */

/**
 * 容器：把 store 里的当前步翻译成展示层的 props 与四个动作。
 * 顺序有讲究——`useEffect`（Esc / 浮层注册）必须在条件 return **之前**，
 * 否则 hooks 的调用数会随步数变化，React 会直接报错。
 */
export default function OnboardingGuide() {
  const step = useAppStore((s) => s.guideStep);
  const open = step !== null;
  const idx = step ?? 0;

  /** 收尾：关引导 + 全局记一次（走完与跳过同等对待，不该第二次强拆用户工作流） */
  const finish = () => {
    useAppStore.getState().setGuideStep(null);
    markOnboardingSeen();
  };

  // Esc 关闭（浮层注册：弹窗打开期间快捷键层让位，见 overlays.ts）
  useEffect(() => {
    if (!open) return;
    registerOverlay();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      unregisterOverlay();
    };
    // finish 只读 store 与写 localStorage，没有闭包状态需要跟随；只有 open 变化才需重挂监听
  }, [open]);

  // step 为 null（未打开）或非法步数时什么都不渲染——引导不许把用户卡在一个空白浮层里
  const target = step === null ? null : guideTargetOf(idx);
  if (target === null) return null;

  /** 「带我过去」：先把面板摆到位置，再前进——省掉「看完引导还要回来点下一步」这一脚 */
  const goAndNext = () => {
    const app = useAppStore.getState();
    if (target === 'left') app.setLeftOpen(true);
    else app.focusInspector(target === 'stats' ? 'stats' : 'props');
    const n = nextGuideStep(idx);
    if (n < 0) finish();
    else app.setGuideStep(n);
  };

  const onNext = () => {
    const n = nextGuideStep(idx);
    if (n < 0) finish();
    else useAppStore.getState().setGuideStep(n);
  };

  return (
    <GuidePanel
      step={idx}
      onSkip={finish}
      onPrev={() => useAppStore.getState().setGuideStep(prevGuideStep(idx))}
      onNext={onNext}
      onGo={goAndNext}
    />
  );
}
