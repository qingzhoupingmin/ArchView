import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GUIDE_LAST_ACTION, GUIDE_STEPS } from '../store/uiHints';
import OnboardingGuide, { GuidePanel } from './OnboardingGuide';

/**
 * 3 步上手引导的静态渲染断言（T4.1）。
 * 走 renderToStaticMarkup 而非 jsdom：引导的内容判定（哪一步高亮、按钮齐不齐、
 * 文案是否仍与 uiHints 同源）全部可在字符串里验，而 useEffect 里的 Esc / 浮层注册
 * 属于浏览器行为，归主人验收（同 StatsPanel.test.tsx 的取舍）。
 *
 * 断言的对象是展示层 `GuidePanel`（props 驱动）而非容器：容器读 zustand，而 SSR 下
 * useSyncExternalStore 走 server snapshot、恒返回 store 初始值，测试设进去的步数它看不见
 * ——这个拆分就是为了「第几步长什么样」能离线钉死。
 */

const noop = (): void => {};
const at = (step: number): string =>
  renderToStaticMarkup(
    <GuidePanel step={step} onSkip={noop} onPrev={noop} onNext={noop} onGo={noop} />,
  );

/** 三个步骤 li 里，哪一个被标成「当前步」 */
function currentStepFlags(html: string): boolean[] {
  return html
    .split('<li class="')
    .slice(1)
    .map((seg) => seg.startsWith('onboard-step onboard-step-cur'));
}

describe('3 步上手引导渲染', () => {
  it('第 1 步：只有第一个步骤条高亮，且没有「上一步」', () => {
    const html = at(0);
    expect(currentStepFlags(html)).toEqual([true, false, false]);
    expect(html).not.toContain('上一步');
    expect(html).toContain(GUIDE_STEPS[0].action);
    expect(html).toContain('跳过');
  });

  it('第 2 步：高亮跟着走、出现「上一步」，前一步标成已完成', () => {
    const html = at(1);
    expect(currentStepFlags(html)).toEqual([false, true, false]);
    expect(html).toContain('onboard-step onboard-step-done');
    expect(html).toContain('上一步');
    expect(html).toContain('下一步');
  });

  it('末步：按钮换成完成文案、不再出现「下一步」（用户要知道自己走完了）', () => {
    const html = at(GUIDE_STEPS.length - 1);
    expect(currentStepFlags(html)).toEqual([false, false, true]);
    expect(html).toContain(GUIDE_LAST_ACTION);
    expect(html).not.toContain('下一步');
  });

  it('正文永远取自 uiHints 的 GUIDE_STEPS（引导文案只有一份事实源，改一处即全站生效）', () => {
    GUIDE_STEPS.forEach((s, i) => {
      const html = at(i);
      expect(html).toContain(s.title);
      expect(html).toContain(s.body);
      expect(html).toContain(s.action);
    });
  });

  it('无障碍：浮层有 role=dialog 与中文 aria-label，关闭按钮有标签', () => {
    const html = at(0);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="上手引导 第 1 步"');
    expect(html).toContain('aria-label="跳过引导"');
  });

  it('步数越界渲染为空（不许留一个空白浮层占住画布下沿）', () => {
    expect(at(GUIDE_STEPS.length)).toBe('');
    expect(at(-1)).toBe('');
  });

  it('容器在未打开状态（guideStep 初值 null）不渲染任何东西', () => {
    expect(renderToStaticMarkup(<OnboardingGuide />)).toBe('');
  });
});
