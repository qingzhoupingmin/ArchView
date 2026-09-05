import { useEffect, useState } from 'react';
import { loadSampleProject } from '@archview/component-lib';
import type { ViewPreset } from '@archview/renderer';
import { useAppStore } from '../store/useAppStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { toastError, toastSuccess } from '../store/useToastStore';
import {
  canLoadSample,
  emptyHintClosed,
  markEmptyHintClosed,
  shouldShowEmptyHint,
} from '../store/uiHints';
import { useViewportBridge } from '../hooks/useViewportBridge';
import { useViewportDrop } from '../hooks/useViewportDrop';
import ArrayDialog from './ArrayDialog';
import Dialog from './Dialog';
import OnboardingGuide from './OnboardingGuide';
import { EmptySceneHint } from './viewport/EmptySceneHint';
import { ViewportContextMenu } from './viewport/ViewportContextMenu';
import { ViewportHud } from './viewport/ViewportHud';

/** 「未选中组件」提示的自动退场时间（ms）：它是教学文案而非状态，长期挂着会一直抢视线 */
const HINT_TIMEOUT_MS = 8000;

/**
 * 视口宿主（T0.6 / FR-V01 / FR-V09，视口拆分 Phase 5 后只留「装配 + 业务动作」）。
 *
 * 三件事各归各位，本文件因此从 712 行降到两百来行：
 * - `useViewportBridge`：three.js 视口的生命周期与双向数据流（上行回调 / 下行 effect）；
 * - `useViewportDrop`：组件库拖放放置（FR-M02 / M04）；
 * - `components/viewport/*`：HUD、右键详情菜单、空场景引导卡三块纯展示 UI。
 * 留在这里的只有「需要同时看清 UI 状态与文档动作」的那几个入口：阵列 / 镜像 / 载入示例 / 引导卡退场。
 */
export default function Viewport() {
  const { containerRef, vpRef, compassRef, ctxMenu, setCtxMenu } = useViewportBridge();
  const { onDragOver, onDragLeave, onDrop } = useViewportDrop(vpRef, containerRef);

  const viewMode = useAppStore((s) => s.viewMode);
  const viewPreset = useAppStore((s) => s.viewPreset);
  const selectedId = useAppStore((s) => s.selectedId);
  const selectedIds = useAppStore((s) => s.selectedIds);
  /** 选中的房间 ID（P5：房间可拾取，与组件选择集互斥） */
  const selectedRoomId = useAppStore((s) => s.selectedRoomId);
  const leftOpen = useAppStore((s) => s.leftOpen);
  /** 正在从组件库拖拽的类型 ID（引导卡在此期间临时隐藏，别压在幽灵预览上） */
  const draggingTypeId = useAppStore((s) => s.draggingTypeId);
  /** 快捷键帮助弹窗开关（WASD 移动画布在弹窗打开期间禁用） */
  const helpOpen = useAppStore((s) => s.helpOpen);
  /** 只读标记（数据隔离批次 B）：他人工程连「载入示例」都不该允许——写了也同步不上去 */
  const readOnly = useAppStore((s) => s.readOnly);
  const doc = useDocumentStore((s) => s.doc);
  /** 后端工程 ID 与服务端版本号：载入示例要走与「导入工程文件」同一条 loadProject 落点 */
  const projectId = useDocumentStore((s) => s.projectId);
  const serverVersion = useDocumentStore((s) => s.serverVersion);

  const [hintDismissed, setHintDismissed] = useState(false);
  /**
   * 空场景引导卡是否已被跳过（惰性初值取自 localStorage：全局记一次，跨工程与跨账号沿用）。
   * §10.3 写了「可跳过」却一直没有实现入口——卡片唯一的按钮只管组件库开合，
   * 用户只能靠「放一个组件进去」赶走它，而它正挡在画布中心。
   */
  const [emptyDismissed, setEmptyDismissed] = useState(emptyHintClosed);
  /** 矩形阵列弹窗开关（T2.3 / FR-M05：选中组件时 HUD chip 入口） */
  const [arrayOpen, setArrayOpen] = useState(false);
  /** 「示例会覆盖当前工程」的二次确认开关（T4.1） */
  const [sampleConfirm, setSampleConfirm] = useState(false);

  // 「未选中组件 · 左键点击模型可拾取」是教学文案而非实时状态，此前会一直挂在 HUD 左上角
  // 与工程信息 chip 抢视线（截图反馈的 HUD 冗余）。改为 8s 后自动退场；一旦选中过也不再出现。
  useEffect(() => {
    const t = window.setTimeout(() => setHintDismissed(true), HINT_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, []);

  // WASD 移动画布（交互范式改版 §10.3）：弹窗 / 菜单打开期间禁用，避免操作浮层时按键误平移
  useEffect(() => {
    vpRef.current?.setNavKeysEnabled(!helpOpen && !arrayOpen && !ctxMenu);
  }, [helpOpen, arrayOpen, ctxMenu, vpRef]);

  const count = doc.project.components.length;
  const selected = selectedId ? doc.getComponent(selectedId) : null;

  /** 引导卡显示判定（纯函数，见 store/uiHints 的单测） */
  const showEmptyHint = shouldShowEmptyHint({
    count,
    dismissed: emptyDismissed,
    dragging: !!draggingTypeId,
  });

  /** 跳过空场景引导：置本次挂载状态 + 落 localStorage 标记（之后进任何工程都不再弹） */
  const closeEmptyHint = () => {
    setEmptyDismissed(true);
    markEmptyHintClosed();
  };

  /**
   * 载入示例工程（T4.1 / 产品文档附录 A 黄金样例）。
   * 与顶栏「导入工程文件」共用同一套防护与同一条 `loadProject` 落点：
   * 后端 `projectsCreate` 只接受 `{ name }`，示例内容只能在前端覆盖当前工程、
   * 再交给自动保存引擎同步上去——这是现有架构下唯一不必给 API 加面的做法。
   */
  const doLoadSample = () => {
    if (!projectId) return;
    const p = loadSampleProject();
    useDocumentStore.getState().loadProject(p, projectId, serverVersion);
    setSampleConfirm(false);
    toastSuccess(
      `已载入示例工程「${p.name}」（${p.components.length} 个组件），改动会自动同步到服务器`,
    );
  };
  const onLoadSample = () => {
    const gate = canLoadSample({ readOnly, hasProjectId: !!projectId });
    if (!gate.ok) {
      toastError(gate.reason ?? '现在不能载入示例工程');
      return;
    }
    // 非空必须先问一句：loadProject 会重建 Document、撤销栈一并清空，手滑就找不回来了
    if (count > 0) {
      setSampleConfirm(true);
      return;
    }
    doLoadSample();
  };

  /** 镜像复制（T2.3 / FR-M05 / §10.3）：v1 沿 YZ 平面（x → -x，偏航取反）；
   *  id 参数 = 指定组件（右键详情菜单入口），缺省 = 当前选中 */
  const onMirror = (id?: string) => {
    const target = id ? doc.getComponent(id) : selected;
    if (!target) return;
    const added = useDocumentStore.getState().mirror(target.id);
    if (added) {
      useAppStore.getState().setSelected(added.id);
      toastSuccess(`已镜像复制 ${added.name}`);
    }
  };
  const applyPreset = (k: ViewPreset) => useAppStore.getState().setViewPreset(k);
  const focusComponent = (x: number, y: number, z: number) => vpRef.current?.focusOn(x, y, z);

  // 右键详情菜单数据（交互范式改版 §10.3）：组件 / 房间详情实时取自 doc，不额外建状态
  const ctxComp = ctxMenu?.componentId ? doc.getComponent(ctxMenu.componentId) : undefined;
  const ctxType = ctxComp ? doc.getType(ctxComp.typeId) : undefined;
  const ctxRoom = !ctxComp && ctxMenu?.roomId ? doc.getRoom(ctxMenu.roomId) : undefined;

  /** 「定位选中」（右键菜单空处分支）：组件优先、房间兜底 */
  const locateSelection = () => {
    if (selectedId) {
      const c = doc.getComponent(selectedId);
      if (c) focusComponent(c.position.x, c.position.y, c.position.z);
    } else if (selectedRoomId) {
      const r = doc.getRoom(selectedRoomId);
      if (r) focusComponent(r.position.x, 0, r.position.z);
    }
  };

  return (
    <div
      className="viewport-host"
      ref={containerRef}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPointerDown={(e) => {
        if (ctxMenu) setCtxMenu(null);
        // 引导卡「看到即过」：只有点在画布本身（canvas / 容器）才算开始操作。
        // 卡片正文 pointer-events: none 不会成为 target，点 HUD 按钮也不会误关。
        const t = e.target as HTMLElement | null;
        if (!emptyDismissed && (t === containerRef.current || t?.tagName === 'CANVAS')) {
          closeEmptyHint();
        }
      }}
    >
      {viewMode === '2d' && (
        <div className="viewport-2d-tip">
          2D 平面图 · 正交顶视 · 左键选择/拖拽 · Shift+左键框选 · 中键/WASD 平移 · 右键详情 · 滚轮缩放
        </div>
      )}

      {ctxMenu && (
        <ViewportContextMenu
          menu={ctxMenu}
          comp={ctxComp}
          type={ctxType}
          room={ctxRoom}
          selectedId={selectedId}
          selectedRoomId={selectedRoomId}
          onFocusComp={() =>
            ctxComp && focusComponent(ctxComp.position.x, ctxComp.position.y, ctxComp.position.z)
          }
          onArray={() => setArrayOpen(true)}
          onMirror={() => ctxComp && onMirror(ctxComp.id)}
          onRemoveComp={() => ctxComp && useDocumentStore.getState().removeMany([ctxComp.id])}
          onFocusRoom={() => ctxRoom && focusComponent(ctxRoom.position.x, 0, ctxRoom.position.z)}
          onRemoveRoom={() => ctxRoom && useDocumentStore.getState().removeRoom(ctxRoom.id)}
          onResetView={() => vpRef.current?.resetView()}
          onLocate={locateSelection}
          onClose={() => setCtxMenu(null)}
        />
      )}

      <ViewportHud
        projectName={doc.project.name}
        viewMode={viewMode}
        viewPreset={viewPreset}
        count={count}
        selected={selected}
        selectedCount={selectedIds.length}
        hintDismissed={hintDismissed}
        compassRef={compassRef}
        onApplyPreset={applyPreset}
        onResetView={() => {
          // 3D 先归 iso 再 resetView：两者同一机位（HOME_TARGET / HOME_OFFSET 同源），
          // 但 store 的预设高亮要跟着回落到「等轴」，否则按钮亮着的和看到的不是一回事
          if (viewMode === '3d') useAppStore.getState().setViewPreset('iso');
          vpRef.current?.resetView();
        }}
        onFocus={() =>
          selected && focusComponent(selected.position.x, selected.position.y, selected.position.z)
        }
        onArray={() => setArrayOpen(true)}
        onMirror={() => onMirror()}
      >
        {showEmptyHint && (
          <div className="vp-empty">
            <EmptySceneHint
              viewMode={viewMode}
              leftOpen={leftOpen}
              onClose={closeEmptyHint}
              onLoadSample={onLoadSample}
            />
          </div>
        )}

        {/* 3 步上手引导（T4.1）：非模态浮层，压在画布下沿——两侧面板必须能真的动手操作 */}
        <OnboardingGuide />
      </ViewportHud>

      {/* 载入示例工程的覆盖确认（T4.1）：挂在 host 直接子级，理由见 EmptySceneHint 的注释 */}
      <Dialog
        open={sampleConfirm}
        title="载入示例工程会覆盖当前内容"
        onClose={() => setSampleConfirm(false)}
        width={430}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setSampleConfirm(false)}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={doLoadSample}>
              仍然载入
            </button>
          </>
        }
      >
        <p>
          当前工程已有 {count} 个组件，载入示例（产品文档附录 A 的标准机房）会把它们全部替换掉，
          而且这一步<b>无法用 Ctrl+Z 撤销</b>。想保留现在的内容，请先用「导出 → 工程文件」存一份。
        </p>
      </Dialog>

      {/* 矩形阵列弹窗（T2.3 / FR-M05）：由选中 chip 的「阵列」按钮打开 */}
      <ArrayDialog open={arrayOpen} onClose={() => setArrayOpen(false)} />
    </div>
  );
}
