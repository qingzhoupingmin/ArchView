import { create } from 'zustand';
import {
  AddComponentCommand,
  AddRoomCommand,
  AssignRowsCommand,
  Document,
  RemoveComponentCommand,
  RemoveRoomCommand,
  TransformComponentCommand,
  UpdateRoomCommand,
  alignBuiltinTypes,
  buildRectArray,
  buildRowsFromClusters,
  createComponent,
  createEmptyProject,
  createPowerIndex,
  inferRowClusters,
  isRackComponent,
  migrateProject,
  mirrorComponent,
  uid,
  type Component,
  type PowerIndex,
  type Project,
  type RectArrayOptions,
  type Room,
  type TransformFields,
} from '@archview/core';
import { componentTypes } from '@archview/component-lib';
import { useAppStore } from './useAppStore';

/**
 * Document store（应用层）：持有工程数据的单一事实源 Document。
 * 数据变更一律经 Command（FR-M08），rev 版本号驱动 UI 重渲染（§8.2-1 单向数据流）。
 * T1.5 / T1.6：loadProject（打开工程）/ createLocal（新建草稿）+ projectId 绑定后端。
 * T2.8：房间增删改（弹窗创建，产品文档 §8.2-10）。
 */
interface DocState {
  /** 工程 Document（引用稳定，内容随命令变更） */
  doc: Document;
  /**
   * 电力统计索引（T3.1 记忆化）：与 Document 同生命周期的**应用级单例**。
   * 放 store 而不是组件里，两个理由：
   * ① 组件级持有会因 React 严格模式双挂载多订阅一份、卸载时机也不可靠（静默泄漏）；
   * ② Document 实例全程复用（切工程走 setProject），而 setProject 必发 `type='project'`
   *    通知 ⇒ 索引自动推倒重建，不会把上一个工程的数字留给下一个工程。
   */
  powerIndex: PowerIndex;
  /** 修订号：每次 Document 变更 +1，触发订阅组件重渲染 */
  rev: number;
  /** 后端工程 ID（null = 尚未绑定后端的新建草稿） */
  projectId: string | null;
  /**
   * 服务端返回的工程版本号（乐观锁基线，批次 D / S9）：
   * PATCH 时作为 baseVersion 提交，服务端版本不一致 → 409，避免多端互相吞改动。
   */
  serverVersion: number | null;
  /** 放置组件（点击组件库卡片），返回实际加入的实例 */
  place: (typeId: string, pos: { x: number; y: number; z: number }) => Component | null;
  removeMany: (ids: string[]) => void;
  undo: () => void;
  redo: () => void;
  /** 打开工程（T1.5）：深拷贝后端 JSON 载入 Document，清空历史 */
  loadProject: (project: Project, backendId: string, serverVersion?: number | null) => void;
  /** 会话清理（批次 A·S2）：登出 / 切账号时把工程态复位为空草稿 */
  reset: () => void;
  /** 新建工程（T1.5）：预置内置组件类型的空工程，未绑定后端 */
  createLocal: (name: string) => Project;
  /** 创建房间（T2.8：弹窗输入尺寸），返回实际加入的房间（重名已自动编号）；只读工程返回 null */
  addRoom: (room: Omit<Room, 'id'>) => Room | null;
  /** 更新房间字段（T2.8） */
  updateRoom: (id: string, patch: Partial<Omit<Room, 'id'>>) => void;
  /** 删除房间（T2.8，v1 不级联组件） */
  removeRoom: (id: string) => void;
  /**
   * 按布局自动成排（T3.1 / D3）：只把**尚未成排**的机柜按几何聚类编进新排，
   * 已有排（含用户改过名的）一律不动；一次识别 = 单条撤销记录。
   * 返回 `{ created 排数, assigned 归组台数 }`；只读工程返回 null。
   */
  autoArrangeRows: () => { created: number; assigned: number } | null;
  /** 变换组件（T2.3/FR-M06）：变换手柄拖拽结束提交，单条撤销记录（FR-M08） */
  transform: (items: { id: string; after: Partial<TransformFields> }[], name?: string) => void;
  /** 单复制（T2.3/FR-M05）：偏移复制（默认 = 宽 + 吸附步长，即「让开一格」），自动编号，返回新实例 */
  duplicate: (id: string, offset?: { x: number; z: number }) => Component | null;
  /** 批量复制（T2.4/FR-M05 多选 + Ctrl+D）：每件按自身「宽 + 吸附步长」偏移，单条命令 = 单条撤销记录 */
  duplicateMany: (ids: string[]) => Component[];
  /** 镜像复制（T2.3/FR-M05）：v1 沿 YZ 平面镜像（x → -x，偏航取反），返回新实例 */
  mirror: (id: string) => Component | null;
  /** 矩形阵列（T2.3/FR-M05）：第一格锚定原件位置，单条 AddComponentCommand = 单条撤销记录 */
  rectArray: (id: string, opts: RectArrayOptions) => Component[];
  /** 复制（Ctrl+C，FR-M05 / T2.7 多选）：深拷贝选择集写入剪贴板（空选择 = 清空剪贴板） */
  copySelection: (ids: string[]) => void;
  /** 粘贴（Ctrl+V，FR-M05）：剪贴板整组偏移粘贴（每件 X 让开自身宽 + 步长、Z 让开一步长），单条命令 = 单条撤销记录（FR-M08） */
  paste: () => Component[];
  /** 剪切（Ctrl+X，FR-M05）= 复制 + 删除（两条历史，可分步撤销） */
  cutSelection: (ids: string[]) => void;
}

/**
 * 载入工程时的类型对齐（T1.5 / T2.9 / T2.11）。导出供单测。
 *
 * - P1：工程文件只保存用到的类型；为空（旧数据）时回退内置组件库（FR-M01）。
 * - T2.9：按 ID 合并缺失的内置类型，否则旧工程放置新增预置组件时 `doc.getType` 落空、静默失败。
 * - **T2.11 修正**：ID 命中内置库时改为**以组件库几何为准**。旧实现「已有类型保留原样」，
 *   于是工程里存盘的 `geometry` 快照（P1 约定随工程保存）会把内置素材永久钉在旧版——
 *   T2.11 的素材精修对已存工程与黄金样例完全不生效，只有新建工程能看到。
 *   覆盖安全的前提：属性面板只编辑**实例**的 color / size / attrs（FR-D01 / D05），
 *   从不编辑 `type.geometry`；ID 不在内置库里的条目仍是用户自定义类型，原样保留（§12 社区轨）。
 */
export function withBuiltinTypes(project: Project): Project {
  return { ...project, types: alignBuiltinTypes(project.types, componentTypes) };
}

function cloneProject(p: Project): Project {
  return JSON.parse(JSON.stringify(p)) as Project;
}

function cloneComp(c: Component): Component {
  return JSON.parse(JSON.stringify(c)) as Component;
}

/**
 * 剪贴板（T2.3 / FR-M05 Ctrl+C·V；T2.7 起支持多选）：存组件集深拷贝（数组，单件 = 长度 1）。
 * 模块级状态（非 React state）：复制/粘贴不驱动 UI 重渲染；切工程时清空，避免跨工程粘贴。
 */
let clipboard: Component[] | null = null;

function createLocalProject(): Project {
  const project = createEmptyProject();
  project.types = [...componentTypes];
  return project;
}

/**
 * 只读守卫（数据隔离专项·批次 B 的前端收口点）：
 * 超管凭 PROJECT_VIEW_ALL 可打开他人工程，但后端写权限仅属主 —— 此时任何编辑都同步不上去，
 * 还会在本地留下「永远同步不了的缓冲」（批次 A 修掉的污染源）。
 * 判定统一收口在 store：十几处组件各写一遍 disabled 迟早漏一个，这里只有一道门。
 */
function isReadOnly(): boolean {
  return useAppStore.getState().readOnly;
}

export const useDocumentStore = create<DocState>((set) => {
  const doc = new Document(createLocalProject());
  /** 电力统计索引：生命周期＝Document 生命周期（见 DocState.powerIndex 注释） */
  const powerIndex = createPowerIndex(doc, (typeId) => doc.getType(typeId));

  const api: Omit<
    DocState,
    'doc' | 'powerIndex' | 'rev' | 'projectId' | 'serverVersion'
  > = {
    place: (typeId, pos) => {
      if (isReadOnly()) return null;
      const type = doc.getType(typeId);
      if (!type) return null;
      const comp = createComponent(type, pos);
      doc.execute(new AddComponentCommand([comp]));
      return comp;
    },
    removeMany: (ids) => {
      if (isReadOnly()) return;
      if (ids.length > 0) doc.execute(new RemoveComponentCommand(ids));
    },
    undo: () => {
      if (isReadOnly()) return;
      doc.undo();
    },
    redo: () => {
      if (isReadOnly()) return;
      doc.redo();
    },
    loadProject: (project, backendId, serverVersion = null) => {
      clipboard = null; // 切工程清空剪贴板，避免跨工程粘贴
      // 载入边界统一收口（T3.1 / 产品文档 §8.2-12）：旧工程缺 `rows` 在此补 `[]`、
      // 成员悬空 rowId 在此摘掉。「不升 schemaVersion 而旧工程仍能打开」全靠这一行兜住。
      doc.setProject(migrateProject(withBuiltinTypes(cloneProject(project))));
      set({ projectId: backendId, serverVersion });
    },
    /**
     * 会话清理（批次 A·S2）：登出 / 切账号时把工程态复位为空草稿。
     * 否则上一个账号的完整工程数据会一直留在内存与 projectId 上 ——
     * 顶栏工程名、导出（JSON / glTF / 截图）走的都是 doc，换账号窗口期内即成串号。
     */
    reset: () => {
      clipboard = null;
      doc.setProject(createLocalProject());
      set((s) => ({ projectId: null, serverVersion: null, rev: s.rev + 1 }));
    },
    createLocal: (name) => {
      clipboard = null;
      const project = { ...createLocalProject(), name };
      doc.setProject(project);
      set({ projectId: null, serverVersion: null });
      return project;
    },
    addRoom: (room) => {
      if (isReadOnly()) return null;
      const id = uid('room');
      doc.execute(new AddRoomCommand({ ...room, id }));
      // execute 返回 void：实际加入的房间（含自动编号名）从 Document 取
      return doc.getRoom(id)!;
    },
    updateRoom: (id, patch) => {
      if (isReadOnly()) return;
      doc.execute(new UpdateRoomCommand(id, patch));
    },
    removeRoom: (id) => {
      if (isReadOnly()) return;
      doc.execute(new RemoveRoomCommand(id));
    },
    transform: (items, name) => {
      if (isReadOnly()) return;
      if (items.length === 0) return;
      doc.execute(new TransformComponentCommand(items, name));
    },
    duplicate: (id, offset) => {
      if (isReadOnly()) return null;
      const src = doc.getComponent(id);
      if (!src) return null;
      const step = useAppStore.getState().gridStep;
      // 默认偏移 = 宽 + 吸附步长：机柜类正好「让开一格」，与黄金样例列布局一致
      const off = offset ?? { x: src.size.w + step, z: 0 };
      const m = cloneComp(src);
      m.id = uid('c');
      m.position = { x: src.position.x + off.x, y: src.position.y, z: src.position.z + off.z };
      doc.execute(new AddComponentCommand([m], `复制 ${src.name}`));
      return doc.project.components[doc.project.components.length - 1] ?? null;
    },
    duplicateMany: (ids) => {
      if (isReadOnly()) return [];
      const step = useAppStore.getState().gridStep;
      const clones: Component[] = [];
      for (const id of ids) {
        const src = doc.getComponent(id);
        if (!src) continue;
        const m = cloneComp(src);
        m.id = uid('c');
        // 每件按自身「宽 + 吸附步长」让开一格，保持相对布局
        m.position = { x: src.position.x + src.size.w + step, y: src.position.y, z: src.position.z };
        clones.push(m);
      }
      if (clones.length === 0) return [];
      // 一次复制全部 = 单条命令 = 单条撤销记录（FR-M08，与矩形阵列同一口径）
      const name = clones.length > 1 ? `复制组件（${clones.length}）` : `复制 ${clones[0].name}`;
      doc.execute(new AddComponentCommand(clones, name));
      return doc.project.components.slice(-clones.length);
    },
    mirror: (id) => {
      if (isReadOnly()) return null;
      const src = doc.getComponent(id);
      if (!src) return null;
      const m = mirrorComponent(src, 'yz');
      doc.execute(new AddComponentCommand([m], `镜像复制 ${src.name}`));
      return doc.project.components[doc.project.components.length - 1] ?? null;
    },
    rectArray: (id, opts) => {
      if (isReadOnly()) return [];
      const src = doc.getComponent(id);
      if (!src) return [];
      const app = useAppStore.getState();
      const comps = buildRectArray(src, {
        ...opts,
        snapStep: app.gridSnap ? app.gridStep : 0,
      });
      // 一次放置全部 = 单条命令 = 单条撤销记录（FR-M08）
      doc.execute(new AddComponentCommand(comps, `矩形阵列 ${comps.length} 件`));
      return doc.project.components.slice(-comps.length);
    },
    copySelection: (ids) => {
      const items = ids.map((id) => doc.getComponent(id)).filter((c): c is Component => !!c);
      clipboard = items.length > 0 ? items.map(cloneComp) : null;
    },
    paste: () => {
      if (isReadOnly()) return [];
      if (!clipboard || clipboard.length === 0) return [];
      const step = useAppStore.getState().gridStep;
      const clones = clipboard.map((src) => {
        const m = cloneComp(src);
        m.id = uid('c');
        // 偏移粘贴：X 让开「宽 + 一步长」、Z 让开「一步长」，斜向错开保证可见
        m.position = {
          x: src.position.x + src.size.w + step,
          y: src.position.y,
          z: src.position.z + step,
        };
        return m;
      });
      const name = clones.length > 1 ? `粘贴组件（${clones.length}）` : `粘贴 ${clones[0].name}`;
      doc.execute(new AddComponentCommand(clones, name));
      return doc.project.components.slice(-clones.length);
    },
    cutSelection: (ids) => {
      if (isReadOnly()) return;
      // = 复制 + 删除（两条历史条目：先撤恢复删除、再撤清空剪贴板语义不追踪）
      api.copySelection(ids);
      api.removeMany(ids);
    },
    /**
     * 按布局自动成排（T3.1 / D3 那颗按钮的后端）。
     * 只喂「尚未成排」的机柜给聚类：已有排一律不动 —— 否则一次误点就会把用户
     * 手工改过名的排（如「核心机柜区」）连同结构一起重建掉。
     */
    autoArrangeRows: () => {
      if (isReadOnly()) return null;
      const typeOf = (typeId: string) => doc.getType(typeId);
      const loose = doc.project.components.filter((c) => !c.rowId);
      const clusters = inferRowClusters(loose, {
        isCandidate: (c) => isRackComponent(c, typeOf(c.typeId)),
      });
      if (clusters.length === 0) return { created: 0, assigned: 0 };
      const { rows, assignments } = buildRowsFromClusters(clusters, {
        nextId: () => uid('r'),
        labelFrom: doc.project.rows.length, // 接着已有排名继续编（A/B 之后是 C、D…）
      });
      doc.execute(new AssignRowsCommand(rows, assignments));
      return {
        created: rows.length,
        assigned: assignments.reduce((n, a) => n + a.componentIds.length, 0),
      };
    },
  };

  // 变更通知 → rev +1（渲染层的场景同步由 Viewport 组件自行订阅 doc）
  doc.subscribe(() => set((s) => ({ rev: s.rev + 1 })));

  return { doc, powerIndex, rev: 0, projectId: null, serverVersion: null, ...api };
});