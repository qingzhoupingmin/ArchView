import { type DragEvent, type RefObject } from 'react';
import { snapToGrid } from '@archview/core';
import type { Viewport3D } from '@archview/renderer';
import { useAppStore } from '../store/useAppStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { toastSuccess } from '../store/useToastStore';

/**
 * 拖放放置（T2.2 / FR-M02 / M04，视口拆分 Phase 5 抽为 hook）。
 *
 * 2D / 3D 同一视口、同一拾取管线：落点统一走地面（y=0）射线，T2.6 换正交相机后自动沿用。
 * 三个 handler 都只读 store（`getState()`）而不订阅——dragover 是高频事件，
 * 任何 React 重渲染都会直接把幽灵预览的手感拖没。
 */
export function useViewportDrop(
  vpRef: RefObject<Viewport3D | null>,
  hostRef: RefObject<HTMLDivElement | null>,
) {
  /** 正在拖拽的组件类型（dragstart 时写入 store；dragover 期间 DataTransfer 不可读） */
  const draggingType = () => {
    const id = useAppStore.getState().draggingTypeId;
    return id ? useDocumentStore.getState().doc.getType(id) : undefined;
  };

  /** 鼠标屏幕坐标 → 地面坐标 → 网格吸附（FR-M04，步长状态栏 300/600/1200 可配） */
  const groundPosAt = (clientX: number, clientY: number): { x: number; z: number } | null => {
    const raw = vpRef.current?.groundPointAt(clientX, clientY);
    if (!raw) return null;
    const app = useAppStore.getState();
    if (!app.gridSnap) return { x: Math.round(raw.x), z: Math.round(raw.z) };
    return { x: snapToGrid(raw.x, app.gridStep), z: snapToGrid(raw.z, app.gridStep) };
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    const type = draggingType();
    if (!type) return;
    e.preventDefault(); // 允许放置（浏览器默认不允许 drop）
    e.dataTransfer.dropEffect = 'copy';
    const pos = groundPosAt(e.clientX, e.clientY);
    if (!pos) return;
    vpRef.current?.setDragPreview(type, pos.x, pos.z);
    // 拖拽中实时落点坐标：HTML5 拖拽期间 canvas 的 pointermove 不触发，
    // 状态栏坐标会冻结——此处同步（吸附值 = 实际落点，所见即所得）。
    // dragover 高频触发，仅在坐标变化时写 store，避免 StatusBar 冗余重渲染。
    const app = useAppStore.getState();
    const prev = app.cursor;
    if (!prev || prev.x !== pos.x || prev.z !== pos.z) {
      app.setCursor(pos);
    }
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    // 进入子元素（HUD 等）也会触发 dragleave：仍在视口内则不清幽灵
    const host = hostRef.current;
    if (host && e.relatedTarget && host.contains(e.relatedTarget as Node)) return;
    vpRef.current?.clearDragPreview();
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const vp = vpRef.current;
    const app = useAppStore.getState();
    const type = draggingType();
    app.setDraggingTypeId(null);
    if (!type) {
      vp?.clearDragPreview();
      return;
    }
    const pos = groundPosAt(e.clientX, e.clientY);
    if (!pos) {
      vp?.clearDragPreview();
      return;
    }
    // 与点击放置同一入口：AddComponentCommand 可撤销（FR-M08），自动保存 / 崩溃恢复自动覆盖
    const comp = useDocumentStore.getState().place(type.id, { x: pos.x, y: 0, z: pos.z });
    vp?.clearDragPreview();
    if (comp) {
      app.setSelected(comp.id);
      toastSuccess(`已放置 ${comp.name}（拖放）`);
    }
  };

  return { onDragOver, onDragLeave, onDrop };
}
