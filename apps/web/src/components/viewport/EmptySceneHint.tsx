import type { ViewMode } from '@archview/renderer';
import { Icon } from '@archview/ui';
import { onboardingSeen } from '../../store/uiHints';
import { useAppStore } from '../../store/useAppStore';

interface Props {
  viewMode: ViewMode;
  leftOpen: boolean;
  /** 右上角 × /「知道了」/ 点在画布上，任一即关闭并全局记一次（§10.3「可跳过」） */
  onClose(): void;
  /**
   * 「载入示例工程」的入口动作。判定与覆盖确认弹窗留在视口宿主层做
   * （弹窗必须挂在 viewport-host 直接子级——vp-hud 整层 pointer-events: none，
   * 弹窗若开在这一层里会吃不到鼠标事件），本组件只负责把按钮画出来。
   */
  onLoadSample(): void;
}

/**
 * 空场景引导卡（T4.1，视口拆分 Phase 5 抽出）。
 *
 * 卡片本体不吃鼠标事件、只有按钮可点——渲染层的 pointer / wheel 绑在 canvas 上（卡片的兄弟节点），
 * 卡片若吃事件，鼠标一悬停 canvas 就收到 pointerleave 把光标坐标清成 null，
 * 「点组件卡片放到光标处」会退化成放到硬编码默认坐标。这条约定别破。
 */
export function EmptySceneHint({ viewMode, leftOpen, onClose, onLoadSample }: Props) {
  return (
    <div className="vp-empty-card">
      {/* §10.3「可跳过」：右上角 × 与底部「知道了」同义，此前卡片根本没有任何关闭入口 */}
      <button
        type="button"
        className="vp-empty-close"
        title="知道了，不再显示这条提示"
        aria-label="关闭引导提示"
        onClick={onClose}
      >
        <Icon name="close" size={14} />
      </button>
      <div className="vp-empty-icon" aria-hidden="true">
        <Icon name="cube" size={30} />
      </div>
      <p className="vp-empty-title">这个工程还是空的</p>
      <p className="vp-empty-desc">
        {viewMode === '2d'
          ? '从左侧组件库选一个组件，点一下就放在平面图的这里；中键 / WASD 平移，滚轮缩放。'
          : '从左侧组件库选一个组件，点一下就放在光标处；中键拖拽转视角、WASD 移动画布，滚轮缩放。'}
      </p>
      {/* T4.1：主行给「动手」的两个入口（照着做 / 直接看成品），
          「知道了」与组件库开合退到次行——§10.3 的「可跳过」语义一字未改，只是不再独占主按钮位 */}
      <div className="vp-empty-actions">
        <button
          type="button"
          className="btn btn-primary"
          title="三步带你走一遍：放机柜 → 填功率 → 看统计"
          onClick={() => useAppStore.getState().setGuideStep(0)}
        >
          {onboardingSeen() ? '再看一遍上手引导' : '3 步上手引导'}
        </button>
        <button
          type="button"
          className="btn"
          title="载入产品文档附录 A 的标准机房样例（2 排 × 10 机柜 + 空调与配电）"
          onClick={onLoadSample}
        >
          载入示例工程
        </button>
      </div>
      <div className="vp-empty-alt">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          知道了
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          title="开合左侧组件库面板（快捷键 B）"
          onClick={() => useAppStore.getState().toggleLeft()}
        >
          {leftOpen ? '收起组件库' : '打开组件库'}
        </button>
      </div>
    </div>
  );
}