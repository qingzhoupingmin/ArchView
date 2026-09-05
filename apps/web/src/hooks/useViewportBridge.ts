import { useEffect, useRef, useState } from 'react';
import { Viewport3D, type ViewportCallbacks } from '@archview/renderer';
import { useAppStore } from '../store/useAppStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { registerOverlay, unregisterOverlay } from '../overlays';
import { viewportRef } from '../store/viewportRef';

/** 右键详情菜单（交互范式改版 §10.3，2D/3D 共用）：容器相对像素坐标 + 命中目标，null = 关闭 */
export interface CtxMenu {
  x: number;
  y: number;
  componentId: string | null;
  roomId: string | null;
}

/**
 * 视口桥接层（视口拆分 Phase 5）：three.js 视口的**生命周期与双向数据流**收在这一个 hook 里。
 *
 * 抽出来的理由——原来这 180 行与 HUD / 右键菜单 / 引导卡的 JSX 混在同一个 712 行的组件里，
 * 改任何一处 UI 都要在「effect 海洋」里翻找；而数据流本身其实与 React 渲染无关：
 * - **下行**：应用层 store（选中 / 房间选中 / 网格 / 双路开关 / 视图模式 / 视图预设）→ 调视口方法；
 * - **上行**：视口回调（选择 / 光标 / fps / 缩放 / LOD / 合批 / 阴影 / 统计 / 变换提交）→ 写 store 或 doc。
 * 渲染层始终只发事件、不反写 Document（§8.2），这条边界在这里看得最清楚。
 *
 * StrictMode 双挂载由 `vp.dispose()` 兜底；doc 引用在 P0 内稳定（工程切换在 P1），故挂载 effect 不列依赖。
 */
export function useViewportBridge() {
  const containerRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<Viewport3D | null>(null);
  /** 罗盘不进 React state：由 onCamera 以 10Hz 直接改 SVG transform（低配机不掉帧） */
  const compassRef = useRef<SVGGElement>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);

  const doc = useDocumentStore((s) => s.doc);
  const rev = useDocumentStore((s) => s.rev);
  const viewMode = useAppStore((s) => s.viewMode);
  const viewPreset = useAppStore((s) => s.viewPreset);
  const selectedId = useAppStore((s) => s.selectedId);
  const selectedIds = useAppStore((s) => s.selectedIds);
  const selectedRoomId = useAppStore((s) => s.selectedRoomId);
  const gridStep = useAppStore((s) => s.gridStep);
  const gridSnap = useAppStore((s) => s.gridSnap);
  const batching = useAppStore((s) => s.batching);
  const shadowMode = useAppStore((s) => s.shadowMode);

  // 挂载 / 卸载（StrictMode 双挂载由 dispose 兜底）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const callbacks: ViewportCallbacks = {
      onSelectChange: (ids, primary) => useAppStore.getState().setSelection(ids, primary),
      onDoubleClick: (id) => {
        // 双击组件聚焦（T2.4 / §10.3）：目标点移到组件中心，机位偏移不变
        if (!id) return;
        const c = doc.getComponent(id);
        if (c) vpRef.current?.focusOn(c.position.x, c.position.y, c.position.z);
      },
      onCursorMove: (p) => useAppStore.getState().setCursor(p),
      onFps: (fps) => useAppStore.getState().setFps(fps),
      onZoom: (pct) => useAppStore.getState().setZoom(pct),
      // 实际 LOD 档位回写（T2.12）：auto 策略下由相机距离决定，状态栏 chip 据此显示「自动（近/远）」
      onLod: (mode) => useAppStore.getState().setLodMode(mode),
      // 双路开关回写（T2.10g / T2.10a）：渲染层是唯一事实源，store 只跟着显示
      onBatching: (mode) => useAppStore.getState().setBatching(mode),
      onShadowMode: (mode) => useAppStore.getState().setShadowMode(mode),
      // 帧统计（500ms 节拍）：状态栏显示绘制调用与桶数——合批效果必须肉眼可见
      onStats: (stats) => useAppStore.getState().setStats(stats),
      onCamera: (az) => {
        // 罗盘只随方位角旋转，直接改 SVG transform（不进 React state）
        if (compassRef.current) {
          compassRef.current.setAttribute('transform', 'rotate(' + (-az).toFixed(1) + ' 32 32)');
        }
      },
      onTransformLive: (_id, fields) => {
        // 变换拖拽中：状态栏显示吸附后的目标坐标（所见即所得，FR-M04）
        if (fields.position) {
          useAppStore.getState().setCursor({ x: fields.position.x, z: fields.position.z });
        }
      },
      onTransformCommit: (id, fields) => {
        // 拖拽结束 → TransformComponentCommand（单条撤销记录，FR-M08）
        useDocumentStore.getState().transform([{ id, after: fields }]);
      },
      onTransformBatchCommit: (items) => {
        // 组件直接拖拽：整个选择集一起移动 = 单条 TransformComponentCommand = 单条撤销记录
        // （T2.6 / FR-M08，2D/3D 共用）
        useDocumentStore.getState().transform(items);
      },
      onContextMenu: (x, y, hit) => {
        // 右键详情菜单（§10.3，2D/3D 共用）：靠近右 / 下边缘时向内收拢，避免被视口裁掉
        const host = containerRef.current;
        const w = host?.clientWidth ?? 0;
        const h = host?.clientHeight ?? 0;
        setCtxMenu({
          x: Math.min(x, Math.max(w - 230, 0)),
          y: Math.min(y, Math.max(h - 210, 0)),
          componentId: hit.componentId,
          roomId: hit.roomId,
        });
      },
      // 房间拾取（P5）：点中房间地板 = 选中房间；互斥关系由 store 收口
      onRoomClick: (roomId) => {
        useAppStore.getState().setSelectedRoom(roomId);
      },
    };
    const vp = new Viewport3D(el, callbacks);
    vpRef.current = vp;
    viewportRef.current = vp;

    // 双路初始档位在挂载组件之前落定（T2.10g / T2.10a）：避免「先按关批建一遍、再换档重建一遍」
    const app = useAppStore.getState();
    vp.setBatching(app.batching);
    vp.setShadowMode(app.shadowMode);
    vp.setLodPolicy(app.lodPolicy);

    // 初始同步
    for (const c of doc.project.components) {
      const type = doc.getType(c.typeId);
      if (type) vp.addOrUpdate(c, type);
    }
    vp.syncRooms(doc.project.rooms); // 房间（T2.8）
    vp.select(app.selectedIds, app.selectedId);
    vp.selectRoom(app.selectedRoomId); // 房间选中态（P5）

    // Document 变更 → 场景增量同步（渲染层不反写 Document）
    const unsubscribe = doc.subscribe((_d, change) => {
      if (change.type === 'added' || change.type === 'project') {
        for (const c of doc.project.components) {
          const type = doc.getType(c.typeId);
          if (type) vp.addOrUpdate(c, type);
        }
      } else if (change.type === 'removed') {
        for (const id of change.componentIds) vp.remove(id);
        // 选择集剔除（T2.4 / FR-M07）：撤销 / 删除后选择集不引用已移除组件
        useAppStore.getState().pruneSelection(change.componentIds);
        // 房间选择集同步剔除（P5）：删除 / 撤销后不悬空
        useAppStore.getState().pruneRoomSelection(change.roomIds ?? []);
      } else {
        // updated：变换 / 属性类变更；undo / redo 不带 ids → 全量重同步
        if (change.componentIds.length > 0) {
          for (const id of change.componentIds) {
            const c = doc.getComponent(id);
            const type = c && doc.getType(c.typeId);
            if (c && type) vp.addOrUpdate(c, type);
          }
        } else {
          for (const c of doc.project.components) {
            const type = doc.getType(c.typeId);
            if (type) vp.addOrUpdate(c, type);
          }
        }
        const a = useAppStore.getState();
        vp.select(a.selectedIds, a.selectedId);
      }
      // 房间：数量少，任何变更（roomIds / 全量）都直接全量同步（T2.8）
      vp.syncRooms(doc.project.rooms);
      // P5：新建房间后自动取景——房间恒以世界原点为中心，而默认机位看向 (6000, 6000)，
      // 不重新框景房间就整体偏在画面左上角（截图反馈「构图怪」的一半成因）
      if (change.type === 'added' && (change.roomIds?.length ?? 0) > 0) vp.frameRooms();
    });

    return () => {
      vpRef.current = null;
      viewportRef.current = null;
      unsubscribe();
      vp.dispose();
    };
    // doc 引用在 P0 内稳定（工程切换在 P1）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 下行同步：应用层 store → 视口 ----------

  // 选中态 → 粉色描边（T2.4：多选每个组件一条描边；手柄仅单选，由渲染层判定）
  useEffect(() => {
    vpRef.current?.select(selectedIds, selectedId);
  }, [selectedIds, selectedId, rev]);

  // 房间选中态（P5）：选中房间 → 视口把该房间的地板与轮廓换成粉色
  useEffect(() => {
    vpRef.current?.selectRoom(selectedRoomId);
  }, [selectedRoomId, rev]);

  // 吸附步长 / 开关 → 网格密度 + 变换手柄吸附（FR-M04 同一约定）
  useEffect(() => {
    vpRef.current?.setGridStep(gridStep, gridSnap);
  }, [gridStep, gridSnap]);

  // 双路开关（T2.10g / T2.10a）：状态栏 chip 或 `?batch=` / `?noshadow=` 启动参数 → 渲染层
  useEffect(() => {
    vpRef.current?.setBatching(batching);
  }, [batching]);
  useEffect(() => {
    vpRef.current?.setShadowMode(shadowMode);
  }, [shadowMode]);

  // 2D / 3D 视图联动（T2.6 / FR-V02 / V03 / §8.2-8）：同场景双相机，选择 / 变换 / 属性两视图共享
  useEffect(() => {
    vpRef.current?.setViewMode(viewMode);
  }, [viewMode]);

  // 视图预设（T2.7 / §10.3 1·2·3·4 + HUD 按钮）：store 驱动，键盘 / 按钮 / 离开工程再进入共用一条路径。
  // 初始挂载：store 默认 'iso' 与视口构造器机位同一机位，应用等价 no-op；
  // 2D 下渲染层 no-op，切回 3D 不重放（T2.6 语义：恢复保存的机位原样），预设高亮 = 最后所选。
  useEffect(() => {
    vpRef.current?.setViewPreset(viewPreset);
  }, [viewPreset]);

  // ---------- 右键详情菜单的浮层语义 ----------
  // Esc 关闭（§10.3 Esc = 取消选择 / 关闭弹窗 同一语义）；注册为浮层后 shortcuts.ts 的
  // Esc 分支只关菜单、不清空选择集（hasOverlay 守卫）。
  useEffect(() => {
    if (!ctxMenu) return;
    registerOverlay();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      unregisterOverlay();
    };
  }, [ctxMenu]);

  // 切视图模式自动关闭菜单（菜单里的目标可能已经不在当前视图里）
  useEffect(() => {
    setCtxMenu(null);
  }, [viewMode]);

  return { containerRef, vpRef, compassRef, ctxMenu, setCtxMenu };
}

