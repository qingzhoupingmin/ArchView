import { describe, expect, it } from 'vitest';
import {
  AddComponentCommand,
  AddRoomCommand,
  Document,
  RemoveComponentCommand,
  TransformComponentCommand,
  createComponent,
  createEmptyProject,
  type ComponentType,
  type Room,
} from './index';

const rackType: ComponentType = {
  id: 't-rack42',
  name: '42U 服务器机柜',
  category: 'it',
  defaultSize: { w: 600, d: 1000, h: 2000 },
  geometry: [{ kind: 'box', size: [600, 2000, 1000], offset: { x: 0, y: 1000, z: 0 } }],
  defaultAttrs: { ratedPowerW: 8000 },
  uSlots: 42,
};

function makeDoc(): Document {
  const doc = new Document(createEmptyProject());
  doc.project.types.push(rackType);
  return doc;
}

function makeRoom(name: string): Room {
  return {
    id: 'room-1',
    name,
    width: 12000,
    depth: 8000,
    height: 3600,
    floorIndex: 1,
    position: { x: 0, z: 0 },
  };
}

describe('Document 历史列表（T2.4 / FR-M08「历史列表可查」）', () => {
  it('空工程无历史', () => {
    const doc = makeDoc();
    expect(doc.history).toEqual([]);
    expect(doc.canUndo).toBe(false);
    expect(doc.canRedo).toBe(false);
  });

  it('按执行顺序记录命令名与时间戳（旧 → 新）', () => {
    const doc = makeDoc();
    const a = createComponent(rackType, { x: 0, y: 0, z: 0 });
    const b = createComponent(rackType, { x: 600, y: 0, z: 0 });
    doc.execute(new AddComponentCommand([a], '放置机柜 A'));
    doc.execute(new AddComponentCommand([b], '放置机柜 B'));
    doc.execute(new RemoveComponentCommand([a.id], '删除机柜 A'));
    doc.execute(new AddRoomCommand(makeRoom('机房 1')));

    const h = doc.history;
    expect(h.map((e) => e.name)).toEqual(['放置机柜 A', '放置机柜 B', '删除机柜 A', '创建房间「机房 1」']);
    expect(h.every((e) => e.undone === false)).toBe(true);
    // 时间戳为合法 ISO 8601 且单调不减（同毫秒内执行允许相等）
    for (let i = 0; i < h.length; i++) {
      expect(Number.isNaN(Date.parse(h[i].time))).toBe(false);
      if (i > 0) expect(Date.parse(h[i].time) >= Date.parse(h[i - 1].time)).toBe(true);
    }
  });

  it('undo / redo 移动 undo 游标（undone 标记切换），时间戳保持原执行时间', () => {
    const doc = makeDoc();
    const a = createComponent(rackType, { x: 0, y: 0, z: 0 });
    const b = createComponent(rackType, { x: 600, y: 0, z: 0 });
    doc.execute(new AddComponentCommand([a], '放置 A'));
    doc.execute(new AddComponentCommand([b], '放置 B'));
    const timeA = doc.history[0].time;

    expect(doc.undo()).toBe(true);
    let h = doc.history;
    // 游标前移：放置 B 变为「已撤销」段
    expect(h.map((e) => e.undone)).toEqual([false, true]);
    expect(h[1].name).toBe('放置 B');

    doc.undo();
    h = doc.history;
    expect(h.every((e) => e.undone)).toBe(true);

    expect(doc.redo()).toBe(true);
    h = doc.history;
    expect(h.map((e) => e.undone)).toEqual([false, true]);
    // redo 不产生新时间戳：仍显示原执行时间
    expect(h[0].time).toBe(timeA);
  });

  it('撤销后执行新命令 → 分支：重做段（旧分支）清空，与 canRedo 一致', () => {
    const doc = makeDoc();
    const a = createComponent(rackType, { x: 0, y: 0, z: 0 });
    doc.execute(new AddComponentCommand([a], '放置 A'));
    doc.undo();
    expect(doc.canRedo).toBe(true);
    // 撤销后「放置 A」进入重做段（可重做）
    expect(doc.history.map((e) => e.undone)).toEqual([true]);

    doc.execute(new AddRoomCommand(makeRoom('机房 2')));
    const h = doc.history;
    // 分支语义（与 CAD 撤销历史一致）：新命令开新分支，被弃的旧分支（「放置 A」）整体移除
    expect(h.map((e) => e.name)).toEqual(['创建房间「机房 2」']);
    expect(h.every((e) => e.undone === false)).toBe(true);
    expect(doc.canRedo).toBe(false);
  });

  it('变换命令的自定义名进入历史（拖拽手柄 / 属性面板共用口径）', () => {
    const doc = makeDoc();
    const a = createComponent(rackType, { x: 0, y: 0, z: 0 });
    doc.execute(new AddComponentCommand([a]));
    doc.execute(
      new TransformComponentCommand(
        [{ id: a.id, after: { position: { x: 3000, y: 0, z: 0 } } }],
        '变换组件',
      ),
    );
    expect(doc.history.map((e) => e.name)).toEqual(['放置组件', '变换组件']);
  });

  it('setProject（新建 / 打开工程）清空历史', () => {
    const doc = makeDoc();
    const a = createComponent(rackType, { x: 0, y: 0, z: 0 });
    doc.execute(new AddComponentCommand([a]));
    doc.undo();
    expect(doc.history.length).toBe(1);

    doc.setProject(createEmptyProject('新工程'));
    expect(doc.history).toEqual([]);
    expect(doc.canUndo).toBe(false);
    expect(doc.canRedo).toBe(false);
  });
});
