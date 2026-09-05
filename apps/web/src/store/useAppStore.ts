import { create } from 'zustand';
import type { LodLevel, LodPolicy } from '@archview/core';
import type { BatchingMode, ShadowMode, ViewPreset, ViewportStats } from '@archview/renderer';

export type ViewMode = '3d' | '2d';
export type SaveStatus = 'saved' | 'dirty' | 'saving';
/** 右栏页签（原 InspectorPanel 本地 state，T4.1 提升：上手引导要能定向切到属性 / 统计） */
export type InspectorTab = 'props' | 'stats';

/**
 * 启动参数覆盖（T2.10g / T2.10a 的验收与测量入口）：`?batch=on|off` 与 `?noshadow=1`。
 * 建模页与 `/fps` 基线页共用同一套参数名——每轮基线不必手点 chip，也保证「同一 URL = 同一档」。
 * 单测在 node 环境跑（无 window），故取值前先判存在。
 */
const param = (key: string): string | null =>
  typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(key);

const initialBatching = (): BatchingMode => (param('batch') === 'off' ? 'off' : 'on');
const initialShadow = (): ShadowMode => (param('noshadow') === '1' ? 'off' : 'on');

/**
 * 应用级 UI 状态（Zustand）。
 * 领域数据（Document / 组件）由批次三的 store 管理；此处是视图 / 选择 / 状态栏等 UI 状态。
 */
interface AppState {
  viewMode: ViewMode;
  leftOpen: boolean;
  rightOpen: boolean;
  /**
   * 主选中组件 ID（最后点击的；2D/3D 共享，FR-V03）。
   * 属性面板 / 变换手柄 / 聚焦 / 阵列等单对象操作都以它为准。
   */
  selectedId: string | null;
  /** 选择集（T2.4 / FR-M07：Ctrl+单击多选；2D 框选 T2.6 复用同一集合） */
  selectedIds: string[];
  /**
   * 当前选中的房间 ID（P5：房间可拾取）。
   * 与组件选择集互斥：选中房间即清空组件选择，反之亦然（属性面板走同一条分支）。
   */
  selectedRoomId: string | null;
  saveStatus: SaveStatus;
  /** 光标在地面（y=0）上的坐标（mm），用于状态栏与放置定位 */
  cursor: { x: number; z: number } | null;
  zoomPct: number;
  fps: number;
  gridSnap: boolean;
  gridStep: number;
  /** 当前 3D 视图预设（T2.7 / §10.3 1·2·3·4 与 HUD 按钮共用；2D 无预设机位，渲染层忽略） */
  viewPreset: ViewPreset;
  /** 快捷键帮助弹窗（T2.7 / §10.3 '?'；顶栏「帮助」按钮与快捷键共用同一开关） */
  helpOpen: boolean;
  /**
   * 素材细节档策略（T2.12 / §6.2 `lod` 字段）：`auto` 按相机距离升降，
   * `far` / `near` 手动锁定（前者保密集阵列帧率，后者保演示与出图细节）。
   */
  lodPolicy: LodPolicy;
  /** 渲染层当前**实际**档位（由 Viewport 的 onLod 回调回写；auto 策略下与 lodPolicy 不同值） */
  lodMode: LodLevel;
  /** 正在拖拽的组件类型 ID（T2.2 拖放放置；null = 未在拖拽，Viewport 据此渲染幽灵预览） */
  draggingTypeId: string | null;
  /**
   * 实例化批渲染开关（T2.10g / 开发计划 §S2.5 B-2「双路并存」）。
   * **默认 `off`**：与现状逐像素等价，主人浏览器验收通过后改 `'on'` 即一行翻默认值。
   */
  batching: BatchingMode;
  /** 阴影通道开关（T2.10a 性能模式最小版）：`off` 省掉约一半 draw call */
  shadowMode: ShadowMode;
  /** 上一统计帧的绘制调用数（与 fps 同一 500ms 节拍；T2.10g 验收口径要在界面上看得见） */
  drawCalls: number;
  /** 实例桶数 = 合批后的单通道 draw call 上限（关批时为 0） */
  buckets: number;
  setBatching: (m: BatchingMode) => void;
  toggleBatching: () => void;
  setShadowMode: (m: ShadowMode) => void;
  toggleShadowMode: () => void;
  setStats: (stats: Pick<ViewportStats, 'calls' | 'buckets'>) => void;
  /**
   * 当前工程对**本账号**是否只读（数据隔离专项·批次 B）：
   * 超管凭 PROJECT_VIEW_ALL 能打开他人工程，但写权限仅属主 —— 此时编辑永远同步不上去，
   * 故 useDocumentStore 的所有 mutation 一律早退，顶栏提示「只读」。
   */
  readOnly: boolean;
  /** 同步被服务端拒绝的原因（4xx 丢弃缓冲后由 saveService 写入；顶栏红字提示用） */
  saveBlocked: string | null;
  setReadOnly: (v: boolean) => void;
  setSaveBlocked: (reason: string | null) => void;
  /** 复位「会话相关」状态（登出 / 切账号时由 teardown 回调调用，S2 的收口点） */
  resetSessionScoped: () => void;
  setViewMode: (mode: ViewMode) => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  /** 单选 / 取消选择（替换整个选择集） */
  setSelected: (id: string | null) => void;
  /** 设置选择集 + 主选中（视口多选上报，T2.4 / FR-M07） */
  setSelection: (ids: string[], primaryId: string | null) => void;
  /** 选中 / 取消选中房间（P5）：非空时清空组件选择集，保持互斥 */
  setSelectedRoom: (id: string | null) => void;
  /** 剔除已被移除的房间（删除 / 撤销后房间选择集不悬空，P5） */
  pruneRoomSelection: (removedRoomIds: string[]) => void;
  /** 剔除已被移除的组件（撤销 / 删除后选择集不悬空，T2.4） */
  pruneSelection: (removedIds: string[]) => void;
  setSaveStatus: (s: SaveStatus) => void;
  setCursor: (c: { x: number; z: number } | null) => void;
  setZoom: (pct: number) => void;
  setFps: (fps: number) => void;
  toggleSnap: () => void;
  setGridStep: (step: number) => void;
  setDraggingTypeId: (id: string | null) => void;
  setViewPreset: (p: ViewPreset) => void;
  setHelpOpen: (open: boolean) => void;
  setLodPolicy: (p: LodPolicy) => void;
  setLodMode: (m: LodLevel) => void;
  /** 右栏页签（T4.1 起提升到 store：上手引导第 2 / 3 步要能把面板切到属性 / 统计） */
  inspectorTab: InspectorTab;
  setInspectorTab: (tab: InspectorTab) => void;
  /**
   * 上手引导当前步（T4.1 / 产品文档 §10.3）：null = 未打开。
   * 放 store 而不是组件本地 state，因为高亮要跨三个组件（左栏 / 右栏 / 视口）传阅；
   * 「是否看过」才是持久化的，走 store/uiHints。
   */
  guideStep: number | null;
  setGuideStep: (step: number | null) => void;
  /** 面板显式打开（引导的「带我过去」用；toggle 做不到「确保打开」这个语义） */
  setLeftOpen: (open: boolean) => void;
  setRightOpen: (open: boolean) => void;
  /** 开右栏并切到指定页签（引导第 2 / 3 步的一步式导航） */
  focusInspector: (tab: InspectorTab) => void;
}


export const useAppStore = create<AppState>((set) => ({
  viewMode: '3d',
  leftOpen: true,
  rightOpen: true,
  selectedId: null,
  selectedIds: [],
  selectedRoomId: null,
  saveStatus: 'saved',
  cursor: null,
  zoomPct: 100,
  fps: 0,
  gridSnap: true,
  gridStep: 600, // 默认 600mm 模数吸附（FR-M04）
  draggingTypeId: null,
  viewPreset: 'iso',
  helpOpen: false,
  lodPolicy: 'auto',
  lodMode: 'far', // 初始机位距目标 ≈11.4m，在 far 档之外（T2.12 默认阈值 6m / 8.5m）
  batching: initialBatching(), // T2.10g：默认开批（v3.10 验收 ⑤ 通过后翻默认），`?batch=off` 或状态栏 chip 可回退旧路
  shadowMode: initialShadow(), // T2.10a：`?noshadow=1` 关阴影跑对照基线
  drawCalls: 0,
  buckets: 0,
  inspectorTab: 'props',
  guideStep: null,
  readOnly: false,
  saveBlocked: null,
  setReadOnly: (readOnly) => set({ readOnly }),
  setSaveBlocked: (saveBlocked) => set({ saveBlocked }),
  // 登出 / 切账号时的会话态复位（批次 A·S2）：只清「跟当前工程 / 账号绑定」的字段；
  // 视图偏好（面板开合 / 网格 / LOD / 批渲染）跨账号沿用不影响隔离，故保留。
  resetSessionScoped: () =>
    set({
      selectedId: null,
      selectedIds: [],
      selectedRoomId: null,
      saveStatus: 'saved',
      saveBlocked: null,
      readOnly: false,
      cursor: null,
      draggingTypeId: null,
      helpOpen: false,
      // 上手引导属于「这次会话正在做的事」，不跨账号续播（是否看过在 localStorage，不在这里）
      guideStep: null,
    }),

  setViewMode: (viewMode) => set({ viewMode }),
  toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
  toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
  setSelected: (selectedId) =>
    set(
      selectedId
        ? { selectedId, selectedIds: [selectedId], selectedRoomId: null }
        : { selectedId: null, selectedIds: [], selectedRoomId: null },
    ),
  setSelection: (selectedIds, selectedId) =>
    set({
      selectedRoomId: null,
      selectedIds: [...selectedIds],
      selectedId:
        selectedId && selectedIds.includes(selectedId)
          ? selectedId
          : (selectedIds[selectedIds.length - 1] ?? null),
    }),
  pruneSelection: (removedIds) =>
    set((s) => {
      if (!s.selectedIds.some((id) => removedIds.includes(id))) return {};
      const next = s.selectedIds.filter((id) => !removedIds.includes(id));
      const selectedId =
        s.selectedId && next.includes(s.selectedId)
          ? s.selectedId
          : (next[next.length - 1] ?? null);
      return { selectedIds: next, selectedId };
    }),
  setSelectedRoom: (selectedRoomId) =>
    set(
      selectedRoomId
        ? { selectedRoomId, selectedIds: [], selectedId: null }
        : { selectedRoomId: null },
    ),
  pruneRoomSelection: (removedRoomIds) =>
    set((s) =>
      s.selectedRoomId && removedRoomIds.includes(s.selectedRoomId) ? { selectedRoomId: null } : {},
    ),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  setCursor: (cursor) => set({ cursor }),
  setZoom: (zoomPct) => set({ zoomPct }),
  setFps: (fps) => set({ fps }),
  toggleSnap: () => set((s) => ({ gridSnap: !s.gridSnap })),
  setGridStep: (gridStep) => set({ gridStep }),
  setDraggingTypeId: (draggingTypeId) => set({ draggingTypeId }),
  setViewPreset: (viewPreset) => set({ viewPreset }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setLodPolicy: (lodPolicy) => set({ lodPolicy }),
  setLodMode: (lodMode) => set({ lodMode }),
  setBatching: (batching) => set({ batching }),
  toggleBatching: () => set((s) => ({ batching: s.batching === 'on' ? 'off' : 'on' })),
  setShadowMode: (shadowMode) => set({ shadowMode }),
  toggleShadowMode: () => set((s) => ({ shadowMode: s.shadowMode === 'on' ? 'off' : 'on' })),
  setStats: (stats) => set({ drawCalls: stats.calls, buckets: stats.buckets }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  setGuideStep: (guideStep) => set({ guideStep }),
  setLeftOpen: (leftOpen) => set({ leftOpen }),
  setRightOpen: (rightOpen) => set({ rightOpen }),
  /**
   * 引导第 2 / 3 步的「带我过去」：开右栏 + 切页签一步到位。
   * 收在 store 而不是让引导组件去操作两个 setter，是为了让「切页签」这件事只有一个入口
   * （将来右栏再加页签，改这一处就够，不必回头补每个调用点）。
   */
  focusInspector: (tab) => set({ rightOpen: true, inspectorTab: tab }),
}));
