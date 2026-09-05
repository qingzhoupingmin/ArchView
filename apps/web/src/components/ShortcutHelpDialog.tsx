import Dialog from './Dialog';
import { MOUSE_GROUPS, SHORTCUT_GROUPS } from '../shortcut';
import { useAppStore } from '../store/useAppStore';
import { resetOnboardingHints } from '../store/uiHints';

/**
 * 快捷键帮助（T2.7 / §10.3 '?'）：分组快捷键表（SHORTCUT_GROUPS 单一事实源）+ 3D / 2D 鼠标操作范式。
 * '?' 快捷键或顶栏「帮助」按钮打开；Esc / 遮罩 / 关闭按钮关闭（Dialog 统一处理，含浮层注册）。
 * T4.1 起承担「重新显示上手引导」的入口：v3.5 把 `reopenEmptyHint()` 留在了 uiHints 里却无人调用，
 * 这里一次接上——清掉两个「已看过」标记并立刻把 3 步引导放出来。
 */
export default function ShortcutHelpDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  /** 重放引导：清标记 → 打开三步引导 → 关掉本弹窗（否则两层浮层叠着，Esc 一次只关一层会绕） */
  const replayGuide = () => {
    resetOnboardingHints();
    useAppStore.getState().setGuideStep(0);
    onClose();
  };
  return (
    <Dialog
      open={open}
      title="快捷键与操作"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost foot-left"
            title="清掉「已跳过」标记：下次进画布重新出现引导卡，并立刻开始三步引导"
            onClick={replayGuide}
          >
            重新显示上手引导
          </button>
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >

      <div className="sc-help">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="sc-help-group">
            <h4 className="sc-help-title">{group.title}</h4>
            <ul className="sc-help-list">
              {group.entries.map((entry) => (
                <li key={entry.label} className="sc-help-row">
                  <span className="sc-help-label">{entry.label}</span>
                  <span className="sc-help-keys">
                    {entry.keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <section className="sc-help-group">
          <h4 className="sc-help-title">鼠标操作</h4>
          <ul className="sc-help-list">
            {MOUSE_GROUPS.map((group) => (
              <li key={group.title} className="sc-help-mouse">
                <span className="sc-help-mouse-title">{group.title}：</span>
                <span className="sc-help-mouse-text">{group.entries.join(' · ')}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Dialog>
  );
}