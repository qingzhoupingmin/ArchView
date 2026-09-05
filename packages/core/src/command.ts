import type { Document } from './document';
import type { Component, RackRow, Room } from './types';

/**
 * Command（FR-M08 / 设计决策 §8.2-1）：Document 变更的唯一入口，全部可撤销。
 * execute / undo 对称；命令实例只执行一次（redo 即再次 execute）。
 */
export interface Command {
  /** 历史列表展示名 */
  readonly name: string;
  execute(doc: Document): void;
  undo(doc: Document): void;
}

function clone(c: Component): Component {
  return JSON.parse(JSON.stringify(c)) as Component;
}

export type TransformFields = Pick<Component, 'position' | 'rotation' | 'scale' | 'size'>;

/** 放置组件（支持一次放置多个，如矩形阵列 FR-M05） */
export class AddComponentCommand implements Command {
  readonly name: string;
  private readonly components: Component[];

  constructor(components: Component[], name?: string) {
    this.components = components.map(clone);
    this.name = name ?? (components.length > 1 ? `放置组件（${components.length}）` : `放置组件`);
  }

  execute(doc: Document): void {
    for (const c of this.components) doc.addComponent(c);
  }

  undo(doc: Document): void {
    for (const c of this.components) doc.removeComponent(c.id);
  }
}

/** 删除组件（快照恢复，FR-M09） */
export class RemoveComponentCommand implements Command {
  readonly name: string;
  private snapshot: Component[] = [];

  constructor(
    private readonly ids: string[],
    name?: string,
  ) {
    this.name = name ?? (ids.length > 1 ? `删除组件（${ids.length}）` : '删除组件');
  }

  execute(doc: Document): void {
    this.snapshot = [];
    for (const id of this.ids) {
      const c = doc.getComponent(id);
      if (c) this.snapshot.push(clone(c));
    }
    for (const id of this.ids) doc.removeComponent(id);
  }

  undo(doc: Document): void {
    for (const c of this.snapshot) doc.addComponent(c, { skipAutoName: true });
  }
}

/** 变换组件：位置 / 旋转 / 缩放 / 尺寸（FR-M06 / FR-M03） */
export class TransformComponentCommand implements Command {
  readonly name: string;
  private before = new Map<string, TransformFields>();

  constructor(
    private readonly items: { id: string; after: Partial<TransformFields> }[],
    name?: string,
  ) {
    this.name = name ?? '变换组件';
  }

  execute(doc: Document): void {
    this.before = new Map();
    for (const { id, after } of this.items) {
      const c = doc.getComponent(id);
      if (!c) continue;
      this.before.set(id, {
        position: { ...c.position },
        rotation: { ...c.rotation },
        scale: { ...c.scale },
        size: { ...c.size },
      });
      // 走方法层以补发 updated 通知（缺陷说明见 Document.updateComponent 注释）
      doc.transformComponent(id, after);
    }
  }

  undo(doc: Document): void {
    for (const [id, prev] of this.before) {
      if (doc.getComponent(id)) doc.transformComponent(id, prev);
    }
  }
}

/** 更新组件属性 / 基础字段（FR-D：名称 / 电力 / 标签 / 备注 / 颜色 / 显隐） */
export class UpdateComponentCommand implements Command {
  readonly name: string;
  private before: Partial<Component> | null = null;

  constructor(
    private readonly id: string,
    private readonly patch: Partial<Component>,
    name?: string,
  ) {
    this.name = name ?? '更新组件属性';
  }

  execute(doc: Document): void {
    const c = doc.getComponent(this.id);
    if (!c) return;
    this.before = {
      name: c.name,
      attrs: { ...c.attrs },
      tags: [...c.tags],
      note: c.note,
      visible: c.visible,
      color: c.color,
      // rowId 也要快照（T3.1）：漏掉会让「面板里改归属」这条操作撤销后回不去
      rowId: c.rowId,
    };
    // 走方法层以补发 updated 通知（缺陷说明见 Document.updateComponent 注释）
    doc.updateComponent(this.id, this.patch);
  }

  undo(doc: Document): void {
    if (this.before) doc.updateComponent(this.id, this.before);
  }
}

// ---------- 房间命令（T2.8，产品文档 §8.2-10） ----------

function cloneRoom(r: Room): Room {
  return { ...r, position: { ...r.position } };
}

/** 创建房间（v1 = 弹窗输入尺寸，2D 矩形绘制推迟 P2+，FR-M08 可撤销） */
export class AddRoomCommand implements Command {
  readonly name: string;
  private readonly room: Room;

  constructor(room: Room, name?: string) {
    this.room = cloneRoom(room);
    this.name = name ?? `创建房间「${room.name}」`;
  }

  execute(doc: Document): void {
    doc.addRoom(this.room);
  }

  undo(doc: Document): void {
    doc.removeRoom(this.room.id);
  }
}

/** 更新房间：名称 / 尺寸 / 楼层 / 位置（快照还原，FR-M08） */
export class UpdateRoomCommand implements Command {
  readonly name: string;
  private before: Room | null = null;

  constructor(
    private readonly id: string,
    private readonly patch: Partial<Omit<Room, 'id'>>,
    name?: string,
  ) {
    this.name = name ?? '更新房间';
  }

  execute(doc: Document): void {
    const r = doc.getRoom(this.id);
    if (!r) return;
    this.before = cloneRoom(r);
    doc.updateRoom(this.id, this.patch);
  }

  undo(doc: Document): void {
    if (this.before) {
      doc.updateRoom(this.id, {
        name: this.before.name,
        width: this.before.width,
        depth: this.before.depth,
        height: this.before.height,
        floorIndex: this.before.floorIndex,
        position: { ...this.before.position },
      });
    }
  }
}

/** 删除房间（快照恢复；v1 不级联组件，FR-M08） */
export class RemoveRoomCommand implements Command {
  readonly name: string;
  private snapshot: Room | null = null;

  constructor(private readonly id: string, name?: string) {
    this.name = name ?? '删除房间';
  }

  execute(doc: Document): void {
    const r = doc.getRoom(this.id);
    if (r) this.snapshot = cloneRoom(r);
    doc.removeRoom(this.id);
  }

  undo(doc: Document): void {
    if (this.snapshot) doc.addRoom(this.snapshot, { skipAutoName: true });
  }
}

// ---------- 设备排命令（T3.1，产品文档 §8.2-12）----------

function cloneRow(r: RackRow): RackRow {
  return { ...r };
}

/**
 * 创建排（可同时把成员一次挂上 ⇒ **建排 + 归组 = 单条撤销记录**，FR-M08）。
 * 例：自动成排一次产出 N 条排，整体作为一条命令入栈，Ctrl+Z 一次全撤。
 */
export class AddRowCommand implements Command {
  readonly name: string;
  private readonly row: RackRow;
  private readonly memberIds: string[];

  constructor(row: RackRow, memberIds: readonly string[] = [], name?: string) {
    this.row = cloneRow(row);
    this.memberIds = [...memberIds];
    this.name = name ?? `创建排「${row.name}」`;
  }

  execute(doc: Document): void {
    const added = doc.addRow(this.row);
    if (this.memberIds.length > 0) doc.setMembersRow(this.memberIds, added.id);
  }

  undo(doc: Document): void {
    // 先摘成员再删排（removeRow 也会兜底摘一次，两处口径一致，重复执行无害）
    if (this.memberIds.length > 0) doc.setMembersRow(this.memberIds, null);
    doc.removeRow(this.row.id);
  }
}

/** 更新排：名称 / 所属房间（快照还原，FR-M08） */
export class UpdateRowCommand implements Command {
  readonly name: string;
  private before: RackRow | null = null;

  constructor(
    private readonly id: string,
    private readonly patch: Partial<Omit<RackRow, 'id'>>,
    name?: string,
  ) {
    this.name = name ?? '更新排';
  }

  execute(doc: Document): void {
    const r = doc.getRow(this.id);
    if (!r) return;
    this.before = cloneRow(r);
    doc.updateRow(this.id, this.patch);
  }

  undo(doc: Document): void {
    if (this.before) {
      // roomId 用 `in` 判定还原（见 Document.updateRow）：撤销「移出房间」必须能写回 undefined
      doc.updateRow(this.id, {
        name: this.before.name,
        roomId: this.before.roomId,
      });
    }
  }
}

/** 删除排（不级联删组件，与 RemoveRoomCommand 同口径；成员的 rowId 一并快照，可完整撤销） */
export class RemoveRowCommand implements Command {
  readonly name: string;
  private snapshot: RackRow | null = null;
  private memberIds: string[] = [];

  constructor(private readonly id: string, name?: string) {
    this.name = name ?? '删除排';
  }

  execute(doc: Document): void {
    const r = doc.getRow(this.id);
    if (r) this.snapshot = cloneRow(r);
    this.memberIds = doc.project.components.filter((c) => c.rowId === this.id).map((c) => c.id);
    doc.removeRow(this.id);
  }

  undo(doc: Document): void {
    if (!this.snapshot) return;
    doc.addRow(this.snapshot, { skipAutoName: true });
    if (this.memberIds.length > 0) doc.setMembersRow(this.memberIds, this.snapshot.id);
  }
}

/**
 * 批量建排并归组成员（T3.1「按布局自动成排」：一次识别 = **单条**撤销记录，FR-M08）。
 *
 * 语义刻意保守：只接**尚未成排**的机柜（调用方负责过滤），已有排与已归组成员一律不动。
 * 因此 undo 只需删掉本次新建的排——removeRow 会顺带摘走成员 rowId，不会把用户
 * 原有的排结构一起清空（否则「自动成排」一次误点就会抹掉手工改过名的排）。
 */
export class AssignRowsCommand implements Command {
  readonly name: string;
  private readonly rows: RackRow[];
  private readonly assignments: { rowId: string; componentIds: string[] }[];

  constructor(
    rows: readonly RackRow[],
    assignments: readonly { rowId: string; componentIds: string[] }[],
    name?: string,
  ) {
    this.rows = rows.map(cloneRow);
    this.assignments = assignments.map((a) => ({ rowId: a.rowId, componentIds: [...a.componentIds] }));
    this.name = name ?? `自动成排（${rows.length}）`;
  }

  execute(doc: Document): void {
    for (const row of this.rows) {
      const added = doc.addRow(row);
      const a = this.assignments.find((x) => x.rowId === row.id);
      if (a && a.componentIds.length > 0) doc.setMembersRow(a.componentIds, added.id);
    }
  }

  undo(doc: Document): void {
    // 逆序删除：与建立顺序相反，撤销栈回放时命名编号不会串位
    for (let i = this.rows.length - 1; i >= 0; i--) doc.removeRow(this.rows[i].id);
  }
}
