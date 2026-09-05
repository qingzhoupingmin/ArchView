/**
 * 视口门面 API 快照（架构重构 Phase 0 的安全网）
 *
 * 背景：`Viewport3D` 本体跑在浏览器里，vitest 是 `environment: 'node'`，
 * 因此它**没有任何 DOM 单测**（只有 `pickHits` / `BatchLayer` / `capture` 是纯函数级）。
 * 一旦开始把 2500 行上帝类拆成「门面 + 协作者」，最容易出的事故不是逻辑写错，
 * 而是**搬家过程中悄悄丢了某个 public 能力**——应用层调用点不会报错，只会在浏览器里静默失灵。
 *
 * 本测试用「白名单必须存在」的口径锁死门面 API：
 * - 只断言 `REQUIRED` 全部挂在原型上（缺失即红），不禁止新增；
 * - 私有实现（拆分出去的方法）天然不在名单内，搬家不会误报。
 */
import { describe, expect, it } from 'vitest';
import { Viewport3D } from './viewport';

/** 门面必须对外暴露的能力清单（应用层 Viewport.tsx / FpsBaselinePage / saveService 实际用到的全集） */
const REQUIRED: string[] = [
  // 组件与房间同步
  'addOrUpdate',
  'remove',
  'clear',
  'syncRooms',
  // 选择
  'select',
  'selectRoom',
  // 视图模式与运镜
  'setViewMode',
  'setViewPreset',
  'zoomBy',
  'resetView',
  'focusOn',
  'frameArea',
  'frameRooms',
  'groundPointAt',
  'setAutoRotate',
  'setNavKeysEnabled',
  // 网格 / 吸附
  'setGridStep',
  'setGridVisible',
  // 拖放幽灵预览
  'setDragPreview',
  'clearDragPreview',
  // 性能双路（T2.10a / T2.10g）
  'getBatching',
  'setBatching',
  'getBatchStats',
  'getShadowMode',
  'setShadowMode',
  // LOD（T2.12）
  'getLodMode',
  'setLodMode',
  'getLodPolicy',
  'setLodPolicy',
  'getLodRule',
  'setLodRule',
  'withForcedLod',
  // 出图 / 统计 / 生命周期
  'captureImage',
  'getRenderStats',
  'dispose',
];

describe('Viewport3D 门面 API 快照', () => {
  const proto = Viewport3D.prototype as unknown as Record<string, unknown>;

  it('清单本身不重复、不为空（防止名单被误编辑）', () => {
    expect(REQUIRED.length).toBeGreaterThan(30);
    expect(new Set(REQUIRED).size).toBe(REQUIRED.length);
  });

  it('门面保留全部 public 能力（拆分不得丢功能）', () => {
    const missing = REQUIRED.filter((name) => typeof proto[name] !== 'function');
    expect(missing).toEqual([]);
  });
});

/**
 * 包对外导出面快照：`index.ts` 是 `@archview/renderer` 唯一门面，
 * 应用层（Viewport.tsx / FpsBaselinePage.tsx / useAppStore）只认这里。
 * 内部怎么拆都不该动这份名单——动了就是跨包破坏性变更。
 */
describe('@archview/renderer 导出面快照', () => {
  it('保留全部运行时导出（类型导出不便在此断言，由 tsc 保证）', async () => {
    const api = await import('./index');
    expect(Object.keys(api).sort()).toEqual(
      [
        'BATCH_EMISSIVE_VCOLOR',
        'BatchLayer',
        'MAX_CAPTURE_EDGE',
        'TransformHandles',
        'Viewport3D',
        'applyEmissiveVColorPatch',
        'pickComponentIds',
        'pickHits',
        'resolveCaptureScale',
      ].sort(),
    );
  });
});
