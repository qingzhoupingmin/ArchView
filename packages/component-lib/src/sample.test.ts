import { describe, expect, it } from 'vitest';
import {
  AddRowCommand,
  Document,
  UNASSIGNED_ROW_NAME,
  buildRowsFromClusters,
  inferRowClusters,
  isRackComponent,
  summarizeProject,
} from '@archview/core';
import raw from '../data/sample/standard-room.json';
import { componentTypes, loadSampleProject } from './index';

/**
 * 标准机房样例（T0.9 / S2.0b，产品文档附录 A）。
 * 样例是回归 fixture（黄金样例）：Sprint 3 统计断言、T3.6 性能基线、T4.1「载入示例工程」都依赖它，
 * 所以这里把「数量 / 电力 / 布局」一起断言——数据任何漂移都会在这里亮红灯。
 */
describe('标准机房样例（产品文档附录 A）', () => {
  it('core 可加载；机房与组件数量正确', () => {
    const project = loadSampleProject();
    const doc = new Document(project);
    // 机房 1：30m × 20m × 3.6m
    expect(doc.project.rooms).toHaveLength(1);
    const room = doc.project.rooms[0];
    expect([room.width, room.depth, room.height]).toEqual([30000, 20000, 3600]);
    // 2 排 × 10 台 42U 机柜 + 2 台行级空调 + 2 台列头柜 + 2 块冷通道封闭板
    expect(project.components).toHaveLength(26);
    const countByType = (typeId: string) =>
      project.components.filter((c) => c.typeId === typeId).length;
    expect(countByType('it-rack42')).toBe(20);
    expect(countByType('cooling-ac')).toBe(2);
    expect(countByType('power-row-pdu')).toBe(2);
    expect(countByType('cooling-cold-aisle')).toBe(2);
  });

  it('每柜额定 8kW，实际负载 4-7kW，总负载 115.1kW（固定种子可回归）', () => {
    const project = loadSampleProject();
    const racks = project.components.filter((c) => c.typeId === 'it-rack42');
    expect(racks).toHaveLength(20);
    let total = 0;
    for (const rack of racks) {
      expect(rack.attrs.ratedPowerW).toBe(8000);
      const load = Number(rack.attrs.actualLoadW); // attrs 是 Record<string, number | string>
      expect(load).toBeGreaterThanOrEqual(4000);
      expect(load).toBeLessThanOrEqual(7000);
      total += load;
    }
    // 回归基线：seed 20260901 生成的 20 个负载之和
    expect(total).toBe(115100);
  });

  it('排间距 1200mm（中间冷通道），空调制冷量 50kW，组件归属机房 1', () => {
    const project = loadSampleProject();
    const racks = project.components.filter((c) => c.typeId === 'it-rack42');
    const rowA = racks.filter((c) => c.position.z === -1100);
    const rowB = racks.filter((c) => c.position.z === 1100);
    expect(rowA).toHaveLength(10);
    expect(rowB).toHaveLength(10);
    // 排中心距 2200mm − 机柜深 1000mm = 中间冷通道 1200mm
    expect(rowB[0].position.z - rowA[0].position.z - rowA[0].size.d).toBe(1200);
    for (const ac of project.components.filter((c) => c.typeId === 'cooling-ac')) {
      expect(ac.attrs.coolingKW).toBe(50);
    }
    for (const c of project.components) expect(c.roomId).toBe('room-smp-1');
  });

  it('确定性：两次载入一致且互不影响（深拷贝）', () => {
    const a = loadSampleProject();
    const b = loadSampleProject();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    a.components[0].name = '被改动';
    a.rooms[0].width = 123;
    expect(b.components[0].name).not.toBe('被改动');
    expect(b.rooms[0].width).toBe(30000);
  });

  it('用到的类型随工程保存（P1 约定），并与内置组件库同源不漂移', () => {
    const project = loadSampleProject();
    const used = new Set(project.components.map((c) => c.typeId));
    expect(used.size).toBe(4);
    for (const typeId of used) {
      expect(project.types.some((t) => t.id === typeId)).toBe(true);
      // 样例里的类型必须能在内置组件库中找到（同一份 components.json 派生）
      expect(componentTypes.find((t) => t.id === typeId)).toBeDefined();
    }
  });

  it('T2.11：存盘的几何快照在载入时被组件库刷新（精修必须对样例生效）', () => {
    const project = loadSampleProject();
    // 样例只存用到的 4 型（P1 轻量约定），且每型几何必须与内置库逐字段一致
    expect(project.types).toHaveLength(4);
    for (const t of project.types) {
      expect(t.geometry, `${t.id} 仍是旧灰盒快照`).toEqual(
        componentTypes.find((b) => b.id === t.id)!.geometry,
      );
    }
    // 演示脚本的出镜主角必须是多部件 L2，而非单盒
    expect(project.types.find((t) => t.id === 'it-rack42')!.geometry.length).toBeGreaterThan(1);
  });

  it('T3.1：样例存盘于「排」之前（无 rows 字段），载入被 migrateProject 补成空排且不升版本', () => {
    const project = loadSampleProject();
    expect(project.rows).toEqual([]);
    expect(project.schemaVersion).toBe(1); // D1 决策：加法式变更不升版
    expect(raw.schemaVersion).toBe(1); // 磁盘上的 fixture 不许被顺手改掉
  });
});

/**
 * 黄金样例 = 统计模块的回归基线（开发计划 §7.2）。
 * 这些数字同时是 M1 演示脚本「填功率 → 面板显示总功率 / 利用率」的验收口径，
 * 素材或样例任何漂移都会在这里亮红灯，而不是等主人在浏览器里发现数字不对。
 */
describe('标准机房样例的电力统计基线（T3.1 / FR-A01）', () => {
  const makeDoc = () => new Document(loadSampleProject());

  it('机房总计：20 柜 × 8kW = 额定 160kW，负载 115.1kW，利用率 71.9375%', () => {
    const doc = makeDoc();
    const out = summarizeProject(doc.project, (id) => doc.getType(id));
    expect(out.componentCount).toBe(26);
    expect(out.rackCount).toBe(20);
    expect(out.project.count).toBe(26); // 全部组件参与：空调与 PDU 确实也在耗电
    expect(out.project.ratedW).toBe(160000);
    expect(out.project.loadW).toBe(115100);
    expect(out.project.loadRate).toBeCloseTo(115100 / 160000, 10);
  });

  it('未填实际负载 = 6 台（2 空调 + 2 列头柜 + 2 冷通道板），不能被当成「省电」', () => {
    const doc = makeDoc();
    const out = summarizeProject(doc.project, (id) => doc.getType(id));
    expect(out.project.unmeasured).toBe(6);
  });

  it('自动成排识别出的两排与人工 tags 标注的「A 排 / B 排」成员完全一致', () => {
    const doc = makeDoc();
    const typeOf = (id: string) => doc.getType(id);
    const clusters = inferRowClusters(doc.project.components, {
      isCandidate: (c) => isRackComponent(c, typeOf(c.typeId)),
    });
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.componentIds.length)).toEqual([10, 10]);
    expect(clusters[0].axis).toBe('x');
    // 横向 z=-1100 那排在前（cross 升序）⇒ 命名为 A 排，与样例人工标注同序
    const byTag = (tag: string) =>
      doc.project.components.filter((c) => c.tags.includes(tag)).map((c) => c.id);
    const rackOnly = (ids: string[]) =>
      ids.filter((id) => {
        const c = doc.getComponent(id);
        return c && isRackComponent(c, typeOf(c.typeId));
      });
    expect(clusters[0].componentIds).toEqual(rackOnly(byTag('A 排')));
    expect(clusters[1].componentIds).toEqual(rackOnly(byTag('B 排')));
  });

  it('落库后三级汇总：A 排 59kW / B 排 56.1kW；撤销一次全部回到未成排且总量守恒', () => {
    const doc = makeDoc();
    const typeOf = (id: string) => doc.getType(id);
    const clusters = inferRowClusters(doc.project.components, {
      isCandidate: (c) => isRackComponent(c, typeOf(c.typeId)),
    });
    let seq = 0;
    const { rows, assignments } = buildRowsFromClusters(clusters, {
      nextId: () => `row-${++seq}`,
    });
    expect(rows.map((r) => r.name)).toEqual(['A 排', 'B 排']);
    expect(rows[0].roomId).toBe('room-smp-1'); // 成员的房间归属要随簇带出来

    for (const [i, a] of assignments.entries()) {
      doc.execute(new AddRowCommand(rows[i], a.componentIds));
    }
    const out = summarizeProject(doc.project, typeOf);
    expect(
      out.rows.map((r) => [r.name, r.count, r.loadW, r.units.length === r.count]),
    ).toEqual([
      ['A 排', 10, 59000, true],
      ['B 排', 10, 56100, true],
      // 非机柜设备（空调 / 列头柜 / 冷通道板）留在未成排桶：它们不参与成排，但耗电照计
      [UNASSIGNED_ROW_NAME, 6, 0, true],
    ]);
    expect(out.project.loadW).toBe(115100); // 成排只是换视角，绝不能改变机房总计
    expect(out.project.ratedW).toBe(160000);

    doc.undo();
    doc.undo(); // 两条建排命令各自可撤销
    const back = summarizeProject(doc.project, typeOf);
    expect(back.rows).toHaveLength(1);
    expect(back.rows[0].name).toBe(UNASSIGNED_ROW_NAME);
    expect(back.project.loadW).toBe(115100); // 撤销后一台都没丢
    expect(doc.project.rows).toHaveLength(0);
  });
});
