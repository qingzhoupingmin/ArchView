/**
 * 本地缓冲的账号隔离单测（数据隔离专项·批次 A / C）。
 *
 * 覆盖的是三个纯函数（bufferKey / isBufferOwnedBy / chooseRecovery）+ store 层只读门。
 * IndexedDB 读写本身不在这里测：仓库未引入 fake-indexeddb，node 环境也没有 indexedDB，
 * 而跨账号污染的全部判定逻辑都已收口到这几个纯函数里，测它们即可锁住语义。
 */
import { componentTypes } from '@archview/component-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import { bufferKey, chooseRecovery, isBufferOwnedBy, type SaveBuffer } from './saveService';
import { useAppStore } from '../store/useAppStore';
import { useDocumentStore } from '../store/useDocumentStore';

function buf(ownerId: string, projectId = 'p1', savedAt = 1_000): SaveBuffer {
  return { key: bufferKey(ownerId, projectId), ownerId, projectId, savedAt, data: {} as never };
}

describe('本地缓冲的账号隔离（批次 A）', () => {
  it('bufferKey 带账号维度：同一工程在不同账号下互不覆盖', () => {
    expect(bufferKey('u1', 'p1')).toBe('u1:p1');
    expect(bufferKey('u1', 'p1')).not.toBe(bufferKey('u2', 'p1'));
  });

  it('isBufferOwnedBy：只有属主本人认账，未登录一律不认', () => {
    expect(isBufferOwnedBy(buf('u1'), 'u1')).toBe(true);
    expect(isBufferOwnedBy(buf('u1'), 'u2')).toBe(false);
    expect(isBufferOwnedBy(buf('u1'), null)).toBe(false);
  });

  it('chooseRecovery：他人缓冲即使更新也拒用，并标记为可清理的残留', () => {
    // 超管（admin）在属主（u1）的工程上留下的缓冲，比服务端新得多
    const foreign = buf('admin', 'p1', Date.parse('2026-09-01T10:00:00Z'));
    const r = chooseRecovery(foreign, '2026-09-01T09:00:00.000Z', 'u1');
    expect(r).toEqual({ accept: false, staleForeign: true });
  });

  it('chooseRecovery：本人缓冲比服务端新 2s 以上才采用（崩溃恢复，FR-P01）', () => {
    const serverAt = Date.parse('2026-09-01T09:00:00.000Z');
    expect(chooseRecovery(buf('u1', 'p1', serverAt + 5000), '2026-09-01T09:00:00.000Z', 'u1')).toEqual({
      accept: true,
      staleForeign: false,
    });
    // 容差内（含时钟抖动）不算「有未同步改动」，避免每次打开都弹恢复提示
    expect(chooseRecovery(buf('u1', 'p1', serverAt + 1000), '2026-09-01T09:00:00.000Z', 'u1')).toEqual({
      accept: false,
      staleForeign: false,
    });
  });

  it('chooseRecovery：没有缓冲时什么都不做', () => {
    expect(chooseRecovery(null, '2026-09-01T09:00:00.000Z', 'u1')).toEqual({
      accept: false,
      staleForeign: false,
    });
  });
});

describe('工程 store 的只读门（批次 B）', () => {
  /** 用真实内置类型 ID，避免「place 因为类型不存在才返回 null」这种假通过的断言 */
  const typeId = componentTypes[0].id;
  const roomSeed = { name: '只读门测试房间', width: 3000, depth: 3000, height: 3000, floorIndex: 1, position: { x: 0, z: 0 } };

  beforeEach(() => {
    useAppStore.setState({ readOnly: false });
    useDocumentStore.getState().createLocal('只读门测试工程');
  });

  it('对照：非只读时同样的调用确实会写入（证明下面的断言不是假通过）', () => {
    const doc = useDocumentStore.getState();
    expect(doc.place(typeId, { x: 0, y: 0, z: 0 })).not.toBeNull();
    expect(doc.addRoom(roomSeed)).not.toBeNull();
    expect(doc.doc.project.components.length).toBe(1);
    expect(doc.doc.project.rooms.length).toBe(1);
  });

  it('readOnly 开启后，所有 mutation 一律拒绝（他人工程不可写）', () => {
    useAppStore.setState({ readOnly: true });
    const doc = useDocumentStore.getState();

    expect(doc.place(typeId, { x: 0, y: 0, z: 0 })).toBeNull();
    expect(doc.addRoom(roomSeed)).toBeNull();
    expect(doc.duplicate('not-exist')).toBeNull();
    expect(doc.mirror('not-exist')).toBeNull();
    expect(doc.duplicateMany(['not-exist'])).toEqual([]);
    expect(doc.rectArray('not-exist', { rows: 2, cols: 2, dx: 1200, dz: 1200 })).toEqual([]);
    expect(doc.paste()).toEqual([]);
    doc.removeMany(['not-exist']);
    doc.transform([{ id: 'not-exist', after: { position: { x: 1, y: 0, z: 0 } } }]);
    doc.updateRoom('not-exist', { name: 'X' });
    doc.removeRoom('not-exist');
    doc.undo();
    doc.redo();

    expect(doc.doc.project.components.length).toBe(0);
    expect(doc.doc.project.rooms.length).toBe(0);
  });

  it('reset() 复位工程态（登出 / 切账号时调用，S2）：projectId 与版本号清空', () => {
    const store = useDocumentStore;
    store.getState().place(typeId, { x: 0, y: 0, z: 0 });
    store.getState().loadProject(
      { ...store.getState().doc.project, name: '上一账号的工程' },
      'prev-account-project',
      7,
    );
    expect(store.getState().projectId).toBe('prev-account-project');
    expect(store.getState().serverVersion).toBe(7);

    store.getState().reset();
    expect(store.getState().projectId).toBeNull();
    expect(store.getState().serverVersion).toBeNull();
    expect(store.getState().doc.project.name).not.toBe('上一账号的工程');
    expect(store.getState().doc.project.components.length).toBe(0);
  });
});
