/**
 * 出图倍率决策单测（T3.5 / FR-V07）。
 * captureImage 的其余部分只能在浏览器里验（需要真实 WebGL 上下文），
 * 但「该给多少倍率」这件事能在这里钉死——尤其是**绝不返回 <1** 与**不越纹理上限**两条。
 */
import { describe, expect, it } from 'vitest';
import { MAX_CAPTURE_EDGE, resolveCaptureScale } from './capture';

describe('resolveCaptureScale', () => {
  it('常规视口全额给到想要的倍率', () => {
    expect(resolveCaptureScale(1600, 900, 2)).toBe(2);
    expect(resolveCaptureScale(2560, 1440, 2)).toBe(2);
  });

  it('视口过大时自动降档，保证最长边不越纹理上限（越界的表现是一张全黑图且不报错）', () => {
    const s = resolveCaptureScale(5000, 3000, 2);
    expect(s).toBeCloseTo(MAX_CAPTURE_EDGE / 5000, 10);
    expect(5000 * s).toBeLessThanOrEqual(MAX_CAPTURE_EDGE);
    expect(3000 * s).toBeLessThanOrEqual(MAX_CAPTURE_EDGE);
  });

  it('降无可降时停在 1：宁可不出超清，也不交出一张比屏幕还糊的「高清图」', () => {
    expect(resolveCaptureScale(20000, 12000, 2)).toBe(1);
    expect(resolveCaptureScale(9000, 9000, 4)).toBe(1);
  });

  it('want < 1 被抬回 1（倍率语义不允许缩小）', () => {
    expect(resolveCaptureScale(1000, 800, 0.5)).toBe(1);
  });

  it('尺寸非法（0 / 负数 / NaN）回退 1，绝不把 NaN 传给 setPixelRatio', () => {
    expect(resolveCaptureScale(0, 0, 2)).toBe(1);
    expect(resolveCaptureScale(-100, -50, 2)).toBe(1);
    expect(Number.isNaN(resolveCaptureScale(Number.NaN, 900, 2))).toBe(false);
    expect(resolveCaptureScale(Number.NaN, 900, 2)).toBe(1);
  });

  it('正好等于上限的边界不降档也不越界', () => {
    expect(resolveCaptureScale(MAX_CAPTURE_EDGE, 1000, 2)).toBe(1);
    expect(resolveCaptureScale(MAX_CAPTURE_EDGE / 2, 100, 2)).toBe(2);
  });

  it('缺省 want = 2（FR-V07 的「2× 分辨率」口径）', () => {
    expect(resolveCaptureScale(1000, 700)).toBe(2);
  });
});
