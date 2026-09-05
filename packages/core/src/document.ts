import type { Command } from './command';
import { uid } from './ids';
import type { Component, ComponentType, Project, RackRow, Room, Zone } from './types';
import { SCHEMA_VERSION } from './types';

/**
 * 变更通知（渲染层增量同步 / UI 刷新，§8.2-1、§8.2-2）。
 * T2.8：roomIds 标识本次涉及房间的房间变更（产品文档 §8.2-10），
 * 房间 / 功能区变更驱动渲染层房间轮廓与 2D 底图刷新。
 * T3.1：rowIds 同理标识涉及的排（产品文档 §8.2-12）；统计层按 componentIds / rowIds 增量重算。
 */
export interface DocChange {
  type: 'added' | 'removed' | 'updated' | 'project';
  componentIds: string[];
  roomIds?: string[];
  rowIds?: string[];
}

export type DocListener = (doc: Document, change: DocChange) => void;

/**
 * 历史条目（FR-M08「历史列表可查」，T2.4）。
 * 只读视图：命令名 + 首次执行时间戳 + 当前状态（已执行 / 已撤销）。
 */
export interface HistoryEntry {
  /** 命令展示名（Command.name） */
  name: string;
  /** 首次执行时间（ISO 8601；redo 后仍显示原执行时间） */
  time: string;
  /** false = 已执行（在撤销栈中）；true = 已撤销（在重做栈中，可重做） */
  undone: boolean;
}

interface HistoryStackEntry {
  command: Command;
  /** 执行时间戳（ISO 8601）：历史列表按此显示，时间紧可裁（§4.2 裁剪档） */
  time: string;
}

/**
 * Document —— 工程数据的单一事实源（纯 TS，零 three.js 依赖）。
 * 变更一律经 Command（可撤销，FR-M08），执行后通知订阅者；渲染层不反写 Document。
 */
export class Document {
  private project_: Project;
  private undoStack: HistoryStackEntry[] = [];
  private redoStack: HistoryStackEntry[] = [];
  private listeners = new Set<DocListener>();

  constructor(project: Project) {
    this.project_ = project;
  }

  get project(): Project {
    return this.project_;
  }

  /** 全量替换（新建 / 打开工程文件），清空历史 */
  setProject(project: Project): void {
    this.project_ = project;
    this.undoStack = [];
    this.redoStack = [];
    this.notify({ type: 'project', componentIds: project.components.map((c) => c.id) });
  }

  getComponent(id: string): Component | undefined {
    return this.project_.components.find((c) => c.id === id);
  }

  getType(typeId: string): ComponentType | undefined {
    return this.project_.types.find((t) => t.id === typeId);
  }

  getRoom(id: string): Room | undefined {
    return this.project_.rooms.find((r) => r.id === id);
  }

  getZones(roomId?: string): Zone[] {
    const zones = this.project_.zones;
    return roomId ? zones.filter((z) => z.roomId === roomId) : zones;
  }

  /** 添加组件；重名自动编号（FR-M09），返回实际加入的实例 */
  addComponent(component: Component, opts: { skipAutoName?: boolean } = {}): Component {
    const instance: Component = {
      ...component,
      position: { ...component.position },
      rotation: { ...component.rotation },
      scale: { ...component.scale },
      size: { ...component.size },
      attrs: { ...component.attrs },
      uAssignments: component.uAssignments.map((u) => ({ ...u })),
      tags: [...component.tags],
    };
    if (!opts.skipAutoName) {
      instance.name = this.uniqueName(instance.name, instance.id);
    }
    this.project_.components.push(instance);
    this.touch();
    this.notify({ type: 'added', componentIds: [instance.id] });
    return instance;
  }

  removeComponent(id: string): Component | undefined {
    const idx = this.project_.components.findIndex((c) => c.id === id);
    if (idx < 0) return undefined;
    const [removed] = this.project_.components.splice(idx, 1);
    this.touch();
    this.notify({ type: 'removed', componentIds: [id] });
    return removed;
  }

  /**
   * 更新组件字段（attrs / name / tags / note / color / visible，FR-D01 / D05）。
   *
   * **修一处既有缺陷**（T3.1 前置）：Update / Transform 两个命令自 T2.3 / T2.5 起就一直
   * 直接 `Object.assign(实例, patch)`，绕过了 Document 的方法层 ⇒ **一次属性变更都不发通知**。
   * 界面上之所以看不出来：3D 变换是拖拽期间渲染层自己改 group、提交后位置恰好停在正确处，
   * 而撤销 / 重做会发一条「空 ids」通知触发全量重同步——于是「改完属性颜色不刷新」被
   * 误当成「还没撤销所以没变」。统计层接上后此类数字不刷新会立刻暴露，故在此收口。
   * 范式与 updateRoom 完全一致：改数据 → touch → 带 ids 的 updated 通知。
   */
  updateComponent(id: string, patch: Partial<Component>): Component | undefined {
    const c = this.getComponent(id);
    if (!c) return undefined;
    Object.assign(c, patch);
    this.touch();
    this.notify({ type: 'updated', componentIds: [id] });
    return c;
  }

  /** 变换组件位姿 / 尺寸（FR-M03 / M06）：同上，走方法层以补齐变更通知 */
  transformComponent(
    id: string,
    fields: Partial<Pick<Component, 'position' | 'rotation' | 'scale' | 'size'>>,
  ): Component | undefined {
    return this.updateComponent(id, fields);
  }

  /**
   * 房间方法（T2.8，产品文档 §8.2-10）：v1 房间创建 = 弹窗输入尺寸，
   * position 为占地中心（与组件原点约定一致），floorIndex 默认 1。
   */

  /** 添加房间；重名自动编号（与组件同一编号规则），返回实际加入的房间 */
  addRoom(room: Room, opts: { skipAutoName?: boolean } = {}): Room {
    const instance: Room = {
      ...room,
      position: { ...room.position },
    };
    if (!opts.skipAutoName) {
      instance.name = this.uniqueRoomName(instance.name, instance.id);
    }
    this.project_.rooms.push(instance);
    this.touch();
    this.notify({ type: 'added', componentIds: [], roomIds: [instance.id] });
    return instance;
  }

  /** 更新房间字段（name / 尺寸 / 楼层 / 位置），返回更新后的房间 */
  updateRoom(id: string, patch: Partial<Omit<Room, 'id'>>): Room | undefined {
    const room = this.getRoom(id);
    if (!room) return undefined;
    if (patch.name !== undefined) room.name = this.uniqueRoomName(patch.name, room.id);
    if (patch.width !== undefined) room.width = patch.width;
    if (patch.depth !== undefined) room.depth = patch.depth;
    if (patch.height !== undefined) room.height = patch.height;
    if (patch.floorIndex !== undefined) room.floorIndex = patch.floorIndex;
    if (patch.position) room.position = { ...patch.position };
    this.touch();
    this.notify({ type: 'updated', componentIds: [], roomIds: [id] });
    return room;
  }

  /**
   * 删除房间，返回被删房间。v1 不级联组件：
   * 原属该房的组件保留（roomId 悬空引用由渲染层容错），避免删除房间「带走」设备。
   */
  removeRoom(id: string): Room | undefined {
    const idx = this.project_.rooms.findIndex((r) => r.id === id);
    if (idx < 0) return undefined;
    const [removed] = this.project_.rooms.splice(idx, 1);
    this.touch();
    this.notify({ type: 'removed', componentIds: [], roomIds: [id] });
    return removed;
  }

  /**
   * 设备排方法（T3.1，产品文档 §8.2-12）：与房间同一套范式——重名自动编号、
   * 变更一律带 rowIds 通知，渲染层与统计层据此增量刷新。
   */

  getRow(id: string): RackRow | undefined {
    return this.project_.rows.find((r) => r.id === id);
  }

  /** 添加排；重名自动编号（与组件 / 房间同一规则），返回实际加入的排 */
  addRow(row: RackRow, opts: { skipAutoName?: boolean } = {}): RackRow {
    const instance: RackRow = { ...row };
    if (!opts.skipAutoName) {
      instance.name = this.uniqueRowName(instance.name, instance.id);
    }
    this.project_.rows.push(instance);
    this.touch();
    this.notify({ type: 'added', componentIds: [], rowIds: [instance.id] });
    return instance;
  }

  /** 更新排字段（name / roomId）；换房时同步成员的 roomId 交由调用方决定，此处不隐式改成员 */
  updateRow(id: string, patch: Partial<Omit<RackRow, 'id'>>): RackRow | undefined {
    const row = this.getRow(id);
    if (!row) return undefined;
    if (patch.name !== undefined) row.name = this.uniqueRowName(patch.name, row.id);
    // 用 `in` 而非 `!== undefined`：撤销「把排移出房间」时必须能把 roomId 写回 undefined
    if ('roomId' in patch) row.roomId = patch.roomId;
    this.touch();
    this.notify({ type: 'updated', componentIds: [], rowIds: [id] });
    return row;
  }

  /**
   * 删除排，返回被删的那条。与 removeRoom 同口径：**不级联删组件**，
   * 只把成员的 rowId 一并摘掉（留下悬空 rowId 会让统计把它错算进「已删的排」里）。
   */
  removeRow(id: string): RackRow | undefined {
    const idx = this.project_.rows.findIndex((r) => r.id === id);
    if (idx < 0) return undefined;
    const [removed] = this.project_.rows.splice(idx, 1);
    for (const c of this.project_.components) {
      if (c.rowId === id) delete c.rowId;
    }
    this.touch();
    this.notify({ type: 'removed', componentIds: [], rowIds: [id] });
    return removed;
  }

  /**
   * 批量设置成员的 rowId（T3.1：建排 / 自动成排 / 移出排共用）。
   * `rowId = null` 表示摘出。**整批只发一条通知**，配合 AddRowCommand 实现「一次操作 = 单条撤销」；
   * 返回实际变更条数（全未变化时不发通知、不置脏）。
   */
  setMembersRow(componentIds: readonly string[], rowId: string | null): number {
    const target = rowId ?? undefined;
    let changed = 0;
    for (const id of componentIds) {
      const c = this.getComponent(id);
      if (!c || c.rowId === target) continue;
      if (target === undefined) delete c.rowId;
      else c.rowId = target;
      changed++;
    }
    if (changed === 0) return 0;
    this.touch();
    this.notify({ type: 'updated', componentIds: [...componentIds] });
    return changed;
  }

  /** 执行命令（变更唯一入口）；记录时间戳供历史列表（FR-M08，T2.4） */
  execute(command: Command): void {
    command.execute(this);
    this.undoStack.push({ command, time: new Date().toISOString() });
    this.redoStack = [];
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    entry.command.undo(this);
    this.redoStack.push(entry);
    this.touch();
    this.notify({ type: 'updated', componentIds: [] });
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    entry.command.execute(this);
    this.undoStack.push(entry);
    this.touch();
    this.notify({ type: 'updated', componentIds: [] });
    return true;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * 历史列表（FR-M08「历史列表可查」，T2.4）：旧 → 新排列。
   * 前半段 undone=false（已执行，可撤销），后半段 undone=true（已撤销，可重做）；
   * 两段交界处即当前 undo 游标。只读视图，渲染层 / UI 每次渲染时取最新快照。
   */
  get history(): HistoryEntry[] {
    const done: HistoryEntry[] = this.undoStack.map((e) => ({
      name: e.command.name,
      time: e.time,
      undone: false,
    }));
    const undone: HistoryEntry[] = this.redoStack.map((e) => ({
      name: e.command.name,
      time: e.time,
      undone: true,
    }));
    return done.concat(undone);
  }

  /** 订阅变更，返回取消订阅函数 */
  subscribe(listener: DocListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 重名自动编号：机柜 1 → 机柜 1-2 → 机柜 1-3 */
  private uniqueName(name: string, selfId: string): string {
    const exists = (n: string) =>
      this.project_.components.some((c) => c.name === n && c.id !== selfId);
    if (!exists(name)) return name;
    let i = 2;
    while (exists(`${name}-${i}`)) i++;
    return `${name}-${i}`;
  }

  /** 房间重名自动编号（与组件同一编号规则，T2.8） */
  private uniqueRoomName(name: string, selfId: string): string {
    const exists = (n: string) =>
      this.project_.rooms.some((r) => r.name === n && r.id !== selfId);
    if (!exists(name)) return name;
    let i = 2;
    while (exists(`${name}-${i}`)) i++;
    return `${name}-${i}`;
  }

  /** 排名重名自动编号（与组件 / 房间同一编号规则，T3.1） */
  private uniqueRowName(name: string, selfId: string): string {
    const exists = (n: string) => this.project_.rows.some((r) => r.name === n && r.id !== selfId);
    if (!exists(name)) return name;
    let i = 2;
    while (exists(`${name}-${i}`)) i++;
    return `${name}-${i}`;
  }

  private touch(): void {
    this.project_.meta.updatedAt = new Date().toISOString();
  }

  private notify(change: DocChange): void {
    for (const listener of [...this.listeners]) listener(this, change);
  }
}

/** 创建空工程（默认值：网格 600mm 吸附开，FR-M04） */
export function createEmptyProject(name = '未命名工程'): Project {
  const now = new Date().toISOString();
  return {
    id: uid('p'),
    name,
    schemaVersion: SCHEMA_VERSION,
    unit: 'mm',
    grid: { step: 600, snap: true },
    rooms: [],
    rows: [],
    zones: [],
    types: [],
    components: [],
    visibility: 'private',
    meta: { createdAt: now, updatedAt: now },
  };
}

/** 由类型定义创建组件实例（默认值来自类型；position 为世界坐标） */
export function createComponent(
  type: ComponentType,
  position: { x: number; y: number; z: number },
): Component {
  return {
    id: uid('c'),
    typeId: type.id,
    name: type.name,
    position: { ...position },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
    size: { ...type.defaultSize },
    attrs: { ...type.defaultAttrs },
    uAssignments: [],
    tags: [],
    note: '',
    visible: true,
  };
}
