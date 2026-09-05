import type { ReactNode, Ref } from 'react';
import type { Component } from '@archview/core';
import type { ViewMode, ViewPreset } from '@archview/renderer';
import { Icon, type IconName } from '@archview/ui';

/**
 * 视图预设（P2 HUD 视图工具条）。
 * P3：原先按钮里是「轴 / 顶 / 正 / 侧」四个单字 —— 竖排时既看不出方向含义，
 * 又无法跟随主题色。改为方向性描边图标，文字说明退回 title / aria-label。
 */
const PRESETS: { key: ViewPreset; icon: IconName; title: string }[] = [
  { key: 'iso', icon: 'view-iso', title: '等轴测视图' },
  { key: 'top', icon: 'view-top', title: '顶视图（平面布置）' },
  { key: 'front', icon: 'view-front', title: '正视图' },
  { key: 'side', icon: 'view-side', title: '侧视图' },
];

interface Props {
  projectName: string;
  viewMode: ViewMode;
  viewPreset: ViewPreset;
  count: number;
  selected: Component | null | undefined;
  selectedCount: number;
  /** 未选中提示是否已退场（8s 自动 + 一旦选中过就不再出现） */
  hintDismissed: boolean;
  /** 罗盘 <g> 的 ref：transform 由渲染层 onCamera 以 10Hz 直写 DOM，不进 React state */
  compassRef: Ref<SVGGElement>;
  onApplyPreset(preset: ViewPreset): void;
  onResetView(): void;
  onFocus(): void;
  onArray(): void;
  onMirror(): void;
  /** 浮层（空场景引导卡 / 上手引导）挂在同一层，保持原 DOM 结构与 pointer-events 约定不变 */
  children?: ReactNode;
}

/**
 * 视口 HUD（P2，视口拆分 Phase 5 抽出）：左上信息 chip + 右上视图预设 + 右下罗盘。
 *
 * ⚠️ 整层 `pointer-events: none`（样式在 components.css），只在按钮上重新开启。
 * 卡片若吃鼠标事件，canvas 会收到 pointerleave 把光标坐标清成 null，
 * 「点组件卡片放到光标处」就退化成放到硬编码默认坐标——这条约定别破。
 */
export function ViewportHud({
  projectName,
  viewMode,
  viewPreset,
  count,
  selected,
  selectedCount,
  hintDismissed,
  compassRef,
  onApplyPreset,
  onResetView,
  onFocus,
  onArray,
  onMirror,
  children,
}: Props) {
  return (
    <div className="vp-hud">
      <div className="vp-hud-tl">
        <span className="vp-chip">
          <span className="vp-chip-dot" aria-hidden="true" />
          <strong>{projectName}</strong>
          <span className="muted">{viewMode === '3d' ? ' · 3D 视图' : ' · 2D 平面'}</span>
          <span className="muted">{' · ' + count + ' 个组件'}</span>
        </span>
        {selected ? (
          <span className="vp-chip">
            已选：{selected.name}
            {selectedCount > 1 && (
              <span className="muted">（多选 +{selectedCount - 1} · Ctrl+单击加选）</span>
            )}
            <button type="button" className="vp-chip-btn" onClick={onFocus}>
              定位
            </button>
            <button
              type="button"
              className="vp-chip-btn"
              title="矩形阵列：快速成排摆放机柜（FR-M05）"
              onClick={onArray}
            >
              阵列
            </button>
            <button
              type="button"
              className="vp-chip-btn"
              title="镜像复制：沿中心线镜像生成副本（FR-M05）"
              onClick={onMirror}
            >
              镜像
            </button>
          </span>
        ) : (
          !hintDismissed && <span className="vp-chip muted">未选中组件 · 左键点击模型可拾取</span>
        )}
      </div>

      <div className="vp-tools" role="group" aria-label="视图工具">
        {viewMode === '3d' &&
          PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={'vp-tool' + (viewPreset === p.key ? ' active' : '')}
              title={p.title}
              aria-label={p.title}
              aria-pressed={viewPreset === p.key}
              onClick={() => onApplyPreset(p.key)}
            >
              <Icon name={p.icon} size={15} />
            </button>
          ))}
        <button
          type="button"
          className="vp-tool"
          title={viewMode === '2d' ? '重新按内容自适应取景' : '重置机位'}
          aria-label={viewMode === '2d' ? '重新按内容自适应取景' : '重置机位'}
          onClick={onResetView}
        >
          <Icon name="view-reset" size={15} />
        </button>
      </div>

      {/* 罗盘：随相机方位角旋转（transform 由 onCamera 直接写 DOM）；2D 顶视朝向恒定，隐藏 */}
      {viewMode === '3d' && (
        <svg className="vp-gizmo" viewBox="0 0 64 64" role="img" aria-label="方向罗盘">
          <circle cx="32" cy="32" r="29" className="vp-gizmo-ring" />
          <g ref={compassRef}>
            <path d="M32 6 L36 20 L32 17 L28 20 Z" className="vp-gizmo-needle" />
            <path d="M32 58 L28 44 L32 47 L36 44 Z" className="vp-gizmo-tail" />
          </g>
        </svg>
      )}

      {children}
    </div>
  );
}
