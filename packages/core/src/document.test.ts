import { describe, expect, it } from 'vitest';
import {
  AddComponentCommand,
  Document,
  RemoveComponentCommand,
  TransformComponentCommand,
  UpdateComponentCommand,
  createComponent,
  createEmptyProject,
  type ComponentType,
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

describe('Document + Command（T0.5）', () => {
  it('放置组件可撤销 / 重做（FR-M08）', () => {
    const doc = makeDoc();
    const comp = createComponent(rackType, { x: 1200, y: 0, z: 1200 });
    doc.execute(new AddComponentCommand([comp]));
    expect(doc.project.components).toHaveLength(1);

    expect(doc.canUndo).toBe(true);
    expect(doc.undo()).toBe(true);
    expect(doc.project.components).toHaveLength(0);
    expect(doc.canRedo).toBe(true);

    expect(doc.redo()).toBe(true);
    expect(doc.project.components).toHaveLength(1);
    expect(doc.project.components[0].id).toBe(comp.id);
    expect(doc.project.components[0].position).toEqual({ x: 1200, y: 0, z: 1200 });
  });

  it('重名自动编号（FR-M09）', () => {
    const doc = makeDoc();
    const a = createComponent(rackType, { x: 0, y: 0, z: 0 });
    const b = createComponent(rackType, { x: 600, y: 0, z: 0 });
    doc.execute(new AddComponentCommand([a]));
    doc.execute(new AddComponentCommand([b]));
    const names = doc.project.components.map((c) => c.name);
    expect(names).toEqual(['42U 服务器机柜', '42U 服务器机柜-2']);
  });

  it('删除组件可撤销恢复（快照还原位置 / 属性）', () => {
    const doc = makeDoc();
    const a = createComponent(rackType, { x: 1200, y: 0, z: 1800 });
    doc.execute(new AddComponentCommand([a]));
    doc.execute(new UpdateComponentCommand(a.id, { attrs: { ratedPowerW: 6000 } }));
    doc.execute(new RemoveComponentCommand([a.id]));

    expect(doc.project.components).toHaveLength(0);
    doc.undo();
    expect(doc.project.components).toHaveLength(1);
    const restored = doc.project.components[0];
    expect(restored.position).toEqual({ x: 1200, y: 0, z: 1800 });
    expect(restored.attrs.ratedPowerW).toBe(6000);
  });

  it('变换命令：位置 / 尺寸变更可撤销（FR-M03 / M06）', () => {
    const doc = makeDoc();
    const a = createComponent(rackType, { x: 1200, y: 0, z: 1200 });
    doc.execute(new AddComponentCommand([a]));
    doc.execute(
      new TransformComponentCommand([
        {
          id: a.id,
          after: { position: { x: 3000, y: 0, z: 1200 }, size: { w: 800, d: 1000, h: 2000 } },
        },
      ]),
    );
    expect(doc.getComponent(a.id)?.position.x).toBe(3000);
    expect(doc.getComponent(a.id)?.size.w).toBe(800);

    doc.undo();
    expect(doc.getComponent(a.id)?.position.x).toBe(1200);
    expect(doc.getComponent(a.id)?.size.w).toBe(600);
  });

  it('属性更新：电力 / 标签 / 备注可撤销（FR-D）', () => {
    const doc = makeDoc();
    const a = createComponent(rackType, { x: 0, y: 0, z: 0 });
    doc.execute(new AddComponentCommand([a]));
    doc.execute(
      new UpdateComponentCommand(a.id, {
        attrs: { ratedPowerW: 6000, actualLoadW: 4500 },
        tags: ['A 排'],
        note: '演示备注',
      }),
    );
    const c = doc.getComponent(a.id)!;
    expect(c.attrs.ratedPowerW).toBe(6000);
    expect(c.attrs.actualLoadW).toBe(4500);
    expect(c.tags).toEqual(['A 排']);
    expect(c.note).toBe('演示备注');

    doc.undo();
    const c2 = doc.getComponent(a.id)!;
    expect(c2.attrs.ratedPowerW).toBe(8000);
    expect(c2.tags).toEqual([]);
    expect(c2.note).toBe('');
  });

  it('undo 后新命令清空 redo 栈', () => {
    const doc = makeDoc();
    const a = createComponent(rackType, { x: 0, y: 0, z: 0 });
    doc.execute(new AddComponentCommand([a]));
    doc.undo();
    expect(doc.canRedo).toBe(true);

    const b = createComponent(rackType, { x: 600, y: 0, z: 0 });
    doc.execute(new AddComponentCommand([b]));
    expect(doc.canRedo).toBe(false);
    expect(doc.project.components).toHaveLength(1);
    expect(doc.project.components[0].id).toBe(b.id);
  });

  it('subscribe：按变更类型通知（渲染层增量同步依据）', () => {
    const doc = makeDoc();
    const changes: string[] = [];
    doc.subscribe((_d, change) => changes.push(change.type));

    const a = createComponent(rackType, { x: 0, y: 0, z: 0 });
    doc.execute(new AddComponentCommand([a]));
    doc.undo(); // 内部 removeComponent → 'removed'，随后 Document.undo 统一 'updated'
    expect(changes).toContain('added');
    expect(changes).toContain('removed');
    expect(changes[changes.length - 1]).toBe('updated');
  });

  it('空历史 undo / redo 返回 false', () => {
    const doc = makeDoc();
    expect(doc.canUndo).toBe(false);
    expect(doc.undo()).toBe(false);
    expect(doc.redo()).toBe(false);
  });

  it('属性 / 变换变更必须发带 ids 的 updated 通知（T3.1 补：统计层与渲染层的增量依据）', () => {
    const doc = makeDoc();
    const a = createComponent(rackType, { x: 0, y: 0, z: 0 });
    doc.execute(new AddComponentCommand([a]));
    const seen: { type: string; ids: string[] }[] = [];
    doc.subscribe((_d, ch) => seen.push({ type: ch.type, ids: ch.componentIds }));

    doc.execute(new UpdateComponentCommand(a.id, { attrs: { ratedPowerW: 6000 } }));
    expect(seen[seen.length - 1]).toEqual({ type: 'updated', ids: [a.id] });

    seen.length = 0;
    doc.execute(
      new TransformComponentCommand([{ id: a.id, after: { position: { x: 100, y: 0, z: 0 } } }]),
    );
    expect(seen[seen.length - 1]).toEqual({ type: 'updated', ids: [a.id] });

    seen.length = 0;
    doc.undo(); // 撤销栈顶是「变换」：位置应回到 (0,0,0)
    expect(doc.getComponent(a.id)?.position.x).toBe(0);
    expect(seen.some((c) => c.type === 'updated' && c.ids.includes(a.id))).toBe(true);

    seen.length = 0;
    doc.undo(); // 再撤销「属性」：额定功率回到类型默认 8000
    expect(seen.some((c) => c.type === 'updated' && c.ids.includes(a.id))).toBe(true);
    expect(doc.getComponent(a.id)?.attrs.ratedPowerW).toBe(8000);
  });
});
