/**
 * 出图（截图 / 漫游出帧）的可测纯函数部分（T3.5 / FR-V07）。
 *
 * 放独立文件是为了能把「倍率该是多少」这件事单测锁死——而 WebGL 上下文、canvas 读取
 * 这些只能在浏览器里验证的部分留在 Viewport3D.captureImage 里，两者边界清楚。
 */

/**
 * 出图边长上限（px）。取 8192 是保守值：多数 GPU 的 `MAX_TEXTURE_SIZE` 在 8192~16384，
 * 超过后 `toDataURL` 会给出**全黑图而不报错**——那种 bug 在浏览器里最难查，宁可提前降倍率。
 */
export const MAX_CAPTURE_EDGE = 8192;

/**
 * 求出实际可用的像素倍率：不超过 want、且让最长边不越过 maxEdge，并且**永远 ≥ 1**。
 *
 * 为什么不许 < 1：调用方要的是"放大出图"，视口太大时应降的是放大倍率而不是把画面
 * 缩到比屏幕还糊——返回 <1 会让用户拿到一张比屏幕上更小的"高清图"。
 */
export function resolveCaptureScale(
  cssWidth: number,
  cssHeight: number,
  want = 2,
  maxEdge = MAX_CAPTURE_EDGE,
): number {
  const longest = Math.max(cssWidth, cssHeight);
  if (!Number.isFinite(longest) || longest <= 0) return 1;
  const cap = maxEdge / longest;
  return Math.max(1, Math.min(want, cap));
}
