/**
 * `.archview` 工程文件单测（T3.4 / FR-I01）。
 * 重点验两件事：① 往返无损（存出去必须能原样开回来）；② 坏文件给出**能看懂的错**，
 * 而不是静默返回一个空工程——用户导入错文件后看到空白，只会以为数据被清空了。
 */
import {
  SCHEMA_VERSION,
  createComponent,
  createEmptyProject,
  type ComponentType,
  type Project,
} from '@archview/core';
import { describe, expect, it } from 'vitest';
import {
  ARCHVIEW_EXT,
  downloadProjectFile,
  parseProjectFile,
  readProjectFile,
  serializeProject,
} from './projectFile';

const rackType: ComponentType = {
  id: 'it-rack42',
  name: '机柜',
  category: 'it',
  defaultSize: { w: 600, d: 1000, h: 2000 },
  geometry: [],
  defaultAttrs: { ratedPowerW: 8000 },
  uSlots: 42,
};

function sampleProject(): Project {
  const p = createEmptyProject('演示机房');
  p.types.push(rackType);
  p.rooms.push({
    id: 'room-1',
    name: '机房 1',
    width: 30000,
    depth: 20000,
    height: 3600,
    floorIndex: 1,
    position: { x: 0, z: 0 },
  });
  const c = createComponent(rackType, { x: 0, y: 0, z: 0 });
  c.roomId = 'room-1';
  p.components.push(c);
  p.rows.push({ id: 'r1', name: 'A 排', roomId: 'room-1' });
  c.rowId = 'r1';
  return p;
}

/** 解析必成功的快捷出口：失败直接把 error 抛给断言，报错信息一目了然 */
function mustParse(text: string): Project {
  const res = parseProjectFile(text);
  if (!res.ok) throw new Error(`解析应当成功，实际：${res.error}`);
  return res.project;
}

describe('serialize / parse 往返', () => {
  it('存出去能原样开回来（含排与成员归属）', () => {
    const p = sampleProject();
    const back = mustParse(serializeProject(p));
    expect(back).toEqual(p);
    expect(back.rows).toEqual([{ id: 'r1', name: 'A 排', roomId: 'room-1' }]);
    expect(back.components[0].rowId).toBe('r1');
  });

  it('文本是两空格缩进的 JSON、无 BOM，扩展名常量正确', () => {
    const text = serializeProject(sampleProject());
    expect(text.startsWith('{\n  "id":')).toBe(true);
    expect(text.includes('\uFEFF')).toBe(false);
    expect(ARCHVIEW_EXT).toBe('.archview');
  });

  it('成员指向已不存在的排 → 解析时被摘掉（不留悬空引用）', () => {
    const p = sampleProject();
    p.rows = [];
    const back = mustParse(serializeProject(p));
    expect(back.components[0].rowId).toBeUndefined();
  });

  it('文件里的未知字段原样保留（前向兼容：新版本写的数据不被老程序削掉）', () => {
    const raw = { ...sampleProject(), futureField: { hello: 'world' } };
    const back = mustParse(JSON.stringify(raw)) as Project & { futureField?: unknown };
    expect(back.futureField).toEqual({ hello: 'world' });
  });
});

describe('坏文件必须给出能看懂的错', () => {
  const fail = (text: string): string => {
    const res = parseProjectFile(text);
    if (res.ok) throw new Error('解析应当失败');
    return res.error;
  };

  it('不是 JSON / 顶层是数组 / 顶层是标量', () => {
    expect(fail('{"components": [')).toContain('不是合法的 JSON');
    expect(fail('[]')).toContain('顶层不是对象');
    expect(fail('"工程"')).toContain('顶层不是对象');
  });

  it('没有 schemaVersion → 判定为非 ArchView 文件', () => {
    expect(fail('{"name":"随手写的"}')).toContain('schemaVersion');
  });

  it(`版本高于本程序（v${SCHEMA_VERSION + 3}）→ 提示升级而不是硬开`, () => {
    const p = { ...sampleProject(), schemaVersion: SCHEMA_VERSION + 3 };
    expect(fail(JSON.stringify(p))).toContain('高于本程序支持');
  });

  it('核心容器缺失 → 报结构不完整，不会静默返回空工程', () => {
    const noComponents = JSON.parse(serializeProject(sampleProject())) as Record<string, unknown>;
    delete noComponents.components;
    expect(fail(JSON.stringify(noComponents))).toContain('components');

    const noMeta = JSON.parse(serializeProject(sampleProject())) as Record<string, unknown>;
    delete noMeta.meta;
    expect(fail(JSON.stringify(noMeta))).toContain('meta');
  });

  it('非 mm 单位直接拒绝（产品文档 §6.4 的硬约定）', () => {
    const p = { ...sampleProject(), unit: 'm' };
    expect(fail(JSON.stringify(p))).toContain('mm');
  });
});

describe('迁移与读取', () => {
  it('缺 rows 的旧 v1 文件：可开、补空排、migrated 标记为 true', () => {
    const raw = JSON.parse(serializeProject(sampleProject())) as Record<string, unknown>;
    delete raw.rows;
    const res = parseProjectFile(JSON.stringify(raw));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.project.rows).toEqual([]);
      expect(res.migrated).toBe(true);
    }
  });

  it('完整的新文件：migrated 为 false（不给用户多余的「已升级」提示）', () => {
    const res = parseProjectFile(serializeProject(sampleProject()));
    expect(res.ok && res.migrated).toBe(false);
  });

  it('readProjectFile 只依赖 file.text()，故可在 node 里同样测试', async () => {
    const file = { text: async () => serializeProject(sampleProject()) };
    const res = await readProjectFile(file);
    expect(res.ok).toBe(true);

    const broken = { text: async () => '{oops' };
    const bad = await readProjectFile(broken);
    expect(bad.ok).toBe(false);

    const boom = {
      text: () => Promise.reject(new Error('占用')),
    };
    const err = await readProjectFile(boom);
    expect(!err.ok && err.error).toContain('读取失败');
  });

  it('downloadProjectFile 在无 document 的环境里静默跳过（不炸单测）', () => {
    expect(() => downloadProjectFile(sampleProject(), '演示机房.archview')).not.toThrow();
  });
});
