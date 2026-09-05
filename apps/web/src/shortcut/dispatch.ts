import { nextLodPolicy, RemoveRoomCommand } from '@archview/core';
import { useAuthStore } from '../auth/useAuthStore';
import { syncNow } from '../save/saveService';
import { hasOverlay } from '../overlays';
import { useAppStore } from '../store/useAppStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { toastError, toastSuccess } from '../store/useToastStore';
import { viewportRef } from '../store/viewportRef';
import { parseShortcut, presetOf } from './parse';

/**
 * 全局快捷键分发（自 shortcuts.ts 分离）：把 ./parse.ts 判出的动作 ID 落到 store 与视口 API 上。
 * ProjectPage 以 window keydown 注册一次，返回「是否已消费该键事件」。
 */

/**
 * 全局快捷键分发：返回是否已消费该键事件。
 * 守卫：表单控件（INPUT / TEXTAREA / SELECT / contentEditable）聚焦时不拦截——
 * 否则在属性面板输入框里打字会误触 B / G / A 等单键快捷键。
 */
export function handleShortcut(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  ) {
    return false;
  }
  const id = parseShortcut(e);
  if (!id) return false;

  const app = useAppStore.getState();
  const ds = useDocumentStore.getState();
  const doc = ds.doc;

  switch (id) {
    case 'undo':
      e.preventDefault();
      ds.undo();
      break;
    case 'redo':
      e.preventDefault();
      ds.redo();
      break;
    case 'save': {
      // 手动保存（FR-P01 / T1.6）
      e.preventDefault();
      void syncNow(useAuthStore.getState().accessToken).then((ok) => {
        if (ok) toastSuccess('已保存');
        else toastError('同步失败，已保存到本地缓冲（恢复网络后自动同步）');
      });
      break;
    }
    case 'copy': {
      // 复制（T2.3 / FR-M05 / §10.3；T2.7：多选整组复制）
      e.preventDefault();
      const ids = app.selectedIds;
      if (ids.length === 0) break;
      ds.copySelection(ids);
      const name = doc.getComponent(ids[0])?.name;
      toastSuccess(ids.length > 1 ? `已复制 ${ids.length} 个组件` : `已复制 ${name ?? '组件'}`);
      break;
    }
    case 'paste': {
      // 粘贴（T2.3 / FR-M05 / §10.3；T2.7：剪贴板整组粘贴，单条撤销记录 FR-M08）
      e.preventDefault();
      const added = ds.paste();
      if (added.length > 0) {
        app.setSelection(
          added.map((c) => c.id),
          added[0].id,
        );
        toastSuccess(
          added.length > 1 ? `已粘贴 ${added.length} 个组件` : `已粘贴 ${added[0].name}`,
        );
      }
      break;
    }
    case 'cut': {
      // 剪切 = 复制 + 删除（T2.3 / FR-M05 / §10.3；T2.7：多选整组）
      e.preventDefault();
      const ids = app.selectedIds;
      if (ids.length === 0) break;
      ds.cutSelection(ids);
      app.setSelected(null);
      toastSuccess(ids.length > 1 ? `已剪切 ${ids.length} 个组件` : '已剪切');
      break;
    }
    case 'duplicate': {
      // 快速复制（T2.3 / FR-M05 / §10.3）：偏移一个网格间距；多选 = 批量复制（单条撤销记录）
      e.preventDefault();
      const ids = app.selectedIds;
      if (ids.length > 0) {
        const added = ds.duplicateMany(ids);
        if (added.length > 0) {
          app.setSelection(
            added.map((c) => c.id),
            added[0].id,
          );
          toastSuccess(
            added.length > 1 ? `已复制 ${added.length} 个组件` : `已复制 ${added[0].name}`,
          );
        }
      }
      break;
    }
    case 'delete':
      // 删除选中（T2.4：多选一次删全部 = 单条 RemoveComponentCommand = 单条撤销记录，FR-M08）
      // P5：只选中了房间 → 删房间（RemoveRoomCommand，同样单条撤销记录；v1 不级联组件）
      if (app.selectedRoomId && app.selectedIds.length === 0) {
        doc.execute(new RemoveRoomCommand(app.selectedRoomId));
        app.setSelectedRoom(null);
        break;
      }
      ds.removeMany(app.selectedIds);
      break;
    case 'select-all': {
      // 全选（T2.7 / §10.3）：主选中 = 文档顺序第一个组件
      const ids = doc.project.components.map((c) => c.id);
      if (ids.length > 0) app.setSelection(ids, ids[0]);
      break;
    }
    case 'focus-selection': {
      // 聚焦选中（T2.7 / §10.3）：3D = 机位偏移不变移到组件；2D = 平移过去（renderer focusOn 已双模式）
      const sel = app.selectedId;
      if (sel) {
        const c = doc.getComponent(sel);
        if (c) viewportRef.current?.focusOn(c.position.x, c.position.y, c.position.z);
        break;
      }
      // P5：选中的是房间 → 聚焦到房间占地中心（F 与组件共用一个入口）
      if (app.selectedRoomId) {
        const r = doc.getRoom(app.selectedRoomId);
        if (r) viewportRef.current?.focusOn(r.position.x, 0, r.position.z);
      }
      break;
    }
    case 'view-2d-3d':
      e.preventDefault();
      app.setViewMode(app.viewMode === '3d' ? '2d' : '3d');
      break;
    case 'panel-left':
      app.toggleLeft();
      break;
    case 'panel-right':
      app.toggleRight();
      break;
    case 'snap-toggle':
      app.toggleSnap();
      break;
    case 'reset-view':
      // 重置机位（2D = 重新按内容自适应取景）；3D 下预设高亮一并回到等轴（机位 = iso 预设）
      if (app.viewMode === '3d') app.setViewPreset('iso');
      viewportRef.current?.resetView();
      break;
    case 'lod-toggle': {
      // 素材细节档循环（T2.12）：auto → near（锁近，看细节 / 演示）→ far（锁远，密集阵列保帧率）
      e.preventDefault();
      const next = nextLodPolicy(app.lodPolicy);
      app.setLodPolicy(next);
      viewportRef.current?.setLodPolicy(next);
      break;
    }
    case 'preset-top':
    case 'preset-front':
    case 'preset-side':
    case 'preset-iso': {
      const preset = presetOf(id);
      if (preset) app.setViewPreset(preset);
      break;
    }
    case 'help':
      // 快捷键帮助（T2.7 / §10.3 '?'）：再按一次收起
      app.setHelpOpen(!app.helpOpen);
      break;
    case 'escape':
      // Esc（T2.7 / §10.3「取消选择 / 关闭弹窗」同一语义）：
      // 有浮层（弹窗 / 2D 右键菜单）打开时由浮层自身关闭、不碰选择集；无浮层才清空选择
      if (!hasOverlay()) app.setSelected(null);
      break;
  }
  return true;
}
