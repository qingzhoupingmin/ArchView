/**
 * 网格吸附工具（FR-M04 / T2.2）：默认 600mm 模数吸附（对齐架空地板砖边长），
 * 模数可配（300 / 600 / 1200mm，产品文档 §5.1）。
 * 纯函数，前端放置管线共享（拖放幽灵预览 / 点击放置 / 状态栏展示）；
 * 吸附开关（Project.grid.snap）由调用方判定，关闭时绕过本函数。
 */

/**
 * 单轴坐标（mm）吸附到网格模数的整数倍（半分向上，Math.round 语义）。
 * @param value 原始坐标（mm；射线求交结果为浮点，可直接传入）
 * @param step 网格模数（mm：300 / 600 / 1200；≤ 0 时防御性按 1mm 处理，避免除零）
 */
export function snapToGrid(value: number, step: number): number {
  const s = Math.max(step, 1);
  const snapped = Math.round(value / s) * s;
  // 归一化 -0（Math.round(-0.4) === -0），保证展示与 JSON 序列化一致
  return snapped === 0 ? 0 : snapped;
}
