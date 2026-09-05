/**
 * 内置组件类型定义（产品文档 §6.5）。
 * 纯 JSON 数据（几何 + 默认属性）：社区贡献者无需写 TS 即可扩充（§12 开源策略）。
 * 注：§6.5 表格共 53 项（T2.9：8 项改归类 + 30 项新增；「21 / 23」为历史口径）。
 */
import type { ComponentType } from '@archview/core';
import raw from '../data/components.json';

export const componentTypes: ComponentType[] = raw as unknown as ComponentType[];

export function findType(typeId: string): ComponentType | undefined {
  return componentTypes.find((t) => t.id === typeId);
}

/** 标准机房样例（T0.9 / S2.0b，产品文档附录 A） */
export { loadSampleProject } from './sample';

