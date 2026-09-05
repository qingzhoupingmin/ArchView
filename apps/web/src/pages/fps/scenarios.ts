import { createComponent, type Component, type ComponentType } from '@archview/core';
import { componentTypes, loadSampleProject } from '@archview/component-lib';

/**
 * 性能基线的待采样场景（视口 / 页面拆分 Phase 6，自 FpsBaselinePage.tsx 分离）。
 *
 * 这里只有「造数据」的逻辑，不碰 DOM、不碰 three.js —— 页面文件一 import 就会拉起
 * renderer → three.js，把采样 UI 和场景定义拆开之后，场景表本身可以离线读、离线测。
 */

/** 一个待采样场景：数据 + 取景参数 */
export interface ScenarioData {
  comps: Component[];
  types: Map<string, ComponentType>;
  cx: number;
  cz: number;
  extent: number;
}

/** 一个待采样场景：数据 + 取景参数 */
export interface Scenario {
  id: string;
  /** 场景名（进报告表与开发计划 §S2.0d 表，务必与文档里的写法一致） */
  label: string;
  /** 目标帧率（null = 参考档，只出不判定） */
  target: number | null;
  /** 组件数（按钮文案用；真构建留给点击 / 自动跑时） */
  count: number;
  /** 文案说明（为什么有这一档，页面上直接可见，省得主人在文档里翻） */
  note: string;
  build: () => ScenarioData;
}

/** 矩形阵列场景：42U 机柜（600×1000），列距 600mm、行距 1200mm（冷热通道） */
export function buildArray(rows: number, cols: number): {
  comps: Component[];
  cx: number;
  cz: number;
  extent: number;
} {
  const rack = componentTypes.find((t) => t.id === 'it-rack42')!;
  const dx = rack.defaultSize.w + 600;
  const dz = rack.defaultSize.d + 1200;
  const comps: Component[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      comps.push(createComponent(rack, { x: c * dx, y: 0, z: r * dz }));
    }
  }
  const width = (cols - 1) * dx + rack.defaultSize.w;
  const depth = (rows - 1) * dz + rack.defaultSize.d;
  return {
    comps,
    cx: width / 2,
    cz: depth / 2,
    extent: Math.max(width, depth),
  };
}

export const sampleScenario = (): ScenarioData => {
  const p = loadSampleProject();
  return { comps: p.components, types: new Map(p.types.map((t) => [t.id, t])), cx: 15000, cz: 10000, extent: 30000 };
};
export const arrayScenario = (rows: number, cols: number): ScenarioData => {
  const s = buildArray(rows, cols);
  return {
    comps: s.comps,
    types: new Map(componentTypes.map((t) => [t.id, t])),
    cx: s.cx,
    cz: s.cz,
    extent: s.extent,
  };
};

/**
 * 四档场景（开发计划 §4.2 S2.0d 基线记录表逐行对应）。
 * 20×20 是 v2.4 就写进文档的「必测」档，但直到 v3.7 才在这页有按钮——
 * 它的价值：50×20 阵列 depth ≈108m，90%+ 机柜落在阴影视锥（±25m）外被剔除，
 * 数值系统性偏乐观；20×20 的 depth ≈42.8m 居中后 [-21.4m, +21.4m] **刚好全在视锥内**，
 * 是唯一能反映「阴影通道真实开销」的一档。目标帧率文档未规定，此处按 M1 口径取 60fps 从严。
 */
export const SCENARIOS: Scenario[] = [
  {
    id: 'sample',
    label: '标准机房样例',
    target: null,
    count: 26,
    note: '黄金样例（参考档）',
    build: sampleScenario,
  },
  {
    id: 'a10x10',
    label: '10×10 机柜阵列',
    target: 60,
    count: 100,
    note: 'M1 目标 60fps',
    build: () => arrayScenario(10, 10),
  },
  {
    id: 'a20x20',
    label: '20×20 密集阵列',
    target: 60,
    count: 400,
    note: '必测：吃满阴影视锥',
    build: () => arrayScenario(20, 20),
  },
  {
    id: 'a50x20',
    label: '50×20 机柜阵列',
    target: 55,
    count: 1000,
    note: 'v1.0 目标 55fps',
    build: () => arrayScenario(50, 20),
  },
];
