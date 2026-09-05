import { describe, expect, it } from 'vitest';
import {
  AddRoomCommand,
  Document,
  RemoveRoomCommand,
  UpdateRoomCommand,
  computeSiteSize,
  createEmptyProject,
  findRoomOverlap,
  nextRoomPosition,
  roomArea,
  roomRect,
  roomRectsOverlap,
  roomsExtent,
  type DocChange,
  type Room,
} from './index';

/**
 * 房间（T2.8，产品文档 §8.2-10）：AddRoom / UpdateRoom / RemoveRoom 三命令
 * 全部可撤销（FR-M08），DocChange.roomIds 驱动渲染层刷新。
 */
function makeRoom(name: string, id?: string): Room {
  return {
    id: id ?? 'room-test',
    name,
    width: 30000,
    depth: 20000,
    height: 3600,
    floorIndex: 1,
    position: { x: 0, z: 0 },
  };
}

describe('Document 房间方法（T2.8）', () => {
  it('创建房间可撤销 / 重做（FR-M08）', () => {
    const doc = new Document(createEmptyProject());
    const room = makeRoom('机房 1');
    doc.execute(new AddRoomCommand(room));
    expect(doc.project.rooms).toHaveLength(1);
    expect(doc.project.rooms[0].name).toBe('机房 1');
    expect(doc.project.rooms[0].id).toBe(room.id);

    expect(doc.undo()).toBe(true);
    expect(doc.project.rooms).toHaveLength(0);
    expect(doc.redo()).toBe(true);
    expect(doc.project.rooms).toHaveLength(1);
    expect(doc.project.rooms[0].id).toBe(room.id);
    expect(doc.project.rooms[0].position).toEqual({ x: 0, z: 0 });
  });

  it('房间重名自动编号（与组件同一编号规则）', () => {
    const doc = new Document(createEmptyProject());
    // 每个房间 ID 唯一（与真实场景一致：uid 生成）
    doc.execute(new AddRoomCommand(makeRoom('机房 1', 'room-1')));
    doc.execute(new AddRoomCommand(makeRoom('机房 1', 'room-2')));
    doc.execute(new AddRoomCommand(makeRoom('机房 1', 'room-3')));
    const names = doc.project.rooms.map((r) => r.name);
    expect(names).toEqual(['机房 1', '机房 1-2', '机房 1-3']);
  });

  it('更新房间：尺寸 / 位置可撤销（快照还原）', () => {
    const doc = new Document(createEmptyProject());
    const room = makeRoom('机房 1');
    doc.execute(new AddRoomCommand(room));
    doc.execute(
      new UpdateRoomCommand(room.id, {
        width: 24000,
        height: 4200,
        position: { x: 3000, z: 600 },
      }),
    );
    const after = doc.getRoom(room.id)!;
    expect(after.width).toBe(24000);
    expect(after.height).toBe(4200);
    expect(after.position).toEqual({ x: 3000, z: 600 });

    doc.undo();
    const before = doc.getRoom(room.id)!;
    expect(before.width).toBe(30000);
    expect(before.height).toBe(3600);
    expect(before.position).toEqual({ x: 0, z: 0 });
  });

  it('删除房间可撤销（快照还原删除前的状态）', () => {
    const doc = new Document(createEmptyProject());
    const room = makeRoom('机房 1');
    doc.execute(new AddRoomCommand(room));
    doc.execute(new UpdateRoomCommand(room.id, { width: 20000 }));
    doc.execute(new RemoveRoomCommand(room.id));
    expect(doc.project.rooms).toHaveLength(0);

    doc.undo(); // 撤销删除 → 恢复「已更新」的房间
    const restored = doc.getRoom(room.id)!;
    expect(restored.width).toBe(20000);
    expect(restored.name).toBe('机房 1');

    doc.undo(); // 再撤销更新
    expect(doc.getRoom(room.id)!.width).toBe(30000);
  });

  it('删除房间不级联组件（v1 约定）', () => {
    const doc = new Document(createEmptyProject());
    const room = makeRoom('机房 1');
    doc.execute(new AddRoomCommand(room));
    const comp = doc.addComponent({
      id: 'c-test',
      typeId: 'it-rack42',
      name: '机柜',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      size: { w: 600, d: 1000, h: 2000 },
      roomId: room.id,
      attrs: {},
      uAssignments: [],
      tags: [],
      note: '',
      visible: true,
    });
    doc.execute(new RemoveRoomCommand(room.id));
    expect(doc.project.rooms).toHaveLength(0);
    expect(doc.getComponent(comp.id)?.roomId).toBe(room.id); // 组件保留，roomId 悬空由渲染层容错
  });

  it('DocChange：房间变更带 roomIds 通知', () => {
    const doc = new Document(createEmptyProject());
    const changes: DocChange[] = [];
    doc.subscribe((_d, change) => changes.push(change));
    const last = () => changes[changes.length - 1];

    const room = makeRoom('机房 1');
    doc.execute(new AddRoomCommand(room));
    expect(last()).toEqual({ type: 'added', componentIds: [], roomIds: [room.id] });

    doc.execute(new UpdateRoomCommand(room.id, { depth: 18000 }));
    expect(last()).toEqual({ type: 'updated', componentIds: [], roomIds: [room.id] });

    doc.execute(new RemoveRoomCommand(room.id));
    // 命令内部 removeRoom 先发 'removed'，随后 Document.undo/execute 汇总通知
    expect(changes.some((c) => c.type === 'removed' && c.roomIds?.includes(room.id))).toBe(true);
  });
});

/**
 * 房间几何纯函数（P5：房间地板与场地地板冲突修复）：场地生长、同层占地重叠、
 * 新房间默认排布、取景包围盒——渲染层与创建弹窗共用同一份判定，全部在这里锁死。
 */
function geoRoom(id: string, over: Partial<Room> = {}): Room {
  return {
    id,
    name: id,
    width: 30000,
    depth: 20000,
    height: 3600,
    floorIndex: 1,
    position: { x: 0, z: 0 },
    ...over,
  };
}

describe('roomRect 与同层占地重叠（P5 R6）', () => {
  it('position 是占地中心：半跨 = 尺寸 / 2', () => {
    expect(roomRect(geoRoom('r1', { position: { x: 1000, z: -2000 } }))).toEqual({
      minX: -14000,
      maxX: 16000,
      minZ: -12000,
      maxZ: 8000,
    });
  });

  it('贴边不算重叠（共墙是正常布局），交叠才算', () => {
    const a = roomRect(geoRoom('a'));
    expect(roomRectsOverlap(a, roomRect(geoRoom('b', { position: { x: 30000, z: 0 } })))).toBe(
      false,
    );
    expect(roomRectsOverlap(a, roomRect(geoRoom('c', { position: { x: 29400, z: 0 } })))).toBe(
      true,
    );
  });

  it('只比同楼层：不同 floorIndex 允许上下叠层；可忽略自身 id', () => {
    const rooms = [geoRoom('r1'), geoRoom('r2', { floorIndex: 2 })];
    expect(findRoomOverlap(geoRoom('r3'), rooms)?.id).toBe('r1');
    expect(findRoomOverlap(geoRoom('r3', { floorIndex: 2 }), rooms)?.id).toBe('r2');
    expect(findRoomOverlap(geoRoom('r1'), rooms, 'r1')).toBeUndefined();
  });
});

describe('computeSiteSize（P5 R1：场地随房间生长）', () => {
  const opts = { min: 36000, margin: 3000, quantum: 600 };

  it('无房间 = 基准尺寸（零行为变化）', () => {
    expect(computeSiteSize([], opts)).toBe(36000);
  });

  it('30×20 房间仍在 36000 场地内 → 不生长', () => {
    expect(computeSiteSize([geoRoom('r1')], opts)).toBe(36000);
  });

  it('60×40 房间 → 场地长到 66000（半跨 30000 + 边距 3000 再 ×2）', () => {
    const big = geoRoom('big', { width: 60000, depth: 40000 });
    expect(computeSiteSize([big], opts)).toBe(66000);
  });

  it('偏心房间按最大绝对半跨取，并向上取整到 quantum 整数倍', () => {
    const off = geoRoom('off', { width: 600, depth: 600, position: { x: 50000, z: 0 } });
    // 半跨 50300 + 边距 3000 = 53300 → ×2 = 106600 → 取整到 600 的 178 倍
    expect(computeSiteSize([off], opts)).toBe(106800);
    expect(computeSiteSize([off], { ...opts, quantum: 5000 })).toBe(110000);
  });
});

describe('nextRoomPosition（P5 R6：第二个房间不再叠在原点）', () => {
  const opts = { step: 600, gap: 3000, floorIndex: 1 };

  it('同楼层无房间 → 回退世界原点（旧行为）', () => {
    expect(nextRoomPosition([], { width: 30000 }, opts)).toEqual({ x: 0, z: 0 });
  });

  it('已有 30m 宽房间 → 新房间排到东侧 33000（贴边留 3m 通道 + 600 吸附）', () => {
    expect(nextRoomPosition([geoRoom('r1')], { width: 30000 }, opts)).toEqual({ x: 33000, z: 0 });
  });

  it('不同楼层不参考其占地 → 回退原点', () => {
    const upper = [geoRoom('r1', { floorIndex: 2 })];
    expect(nextRoomPosition(upper, { width: 30000 }, opts)).toEqual({ x: 0, z: 0 });
  });
});

describe('roomsExtent / roomArea（取景与面积）', () => {
  it('空集合返回 null', () => {
    expect(roomsExtent([])).toBeNull();
  });

  it('两房间并集：中心取包围盒中点，extent 取最长边', () => {
    const rooms = [geoRoom('a'), geoRoom('b', { position: { x: 60000, z: 0 } })];
    expect(roomsExtent(rooms)).toEqual({ cx: 30000, cz: 0, extent: 90000 });
  });

  it('roomArea = 宽 × 深（mm 平方）', () => {
    expect(roomArea(geoRoom('a'))).toBe(600000000);
  });
});
