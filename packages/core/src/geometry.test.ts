/**
 * 组件几何纯函数单测（S2.5 / T2.10b，产品文档 §6.2 / §8.2-11）：
 * 重点锁三件事——① `ground` 锚点必须与旧实现（整组 group.scale）**逐轴等价**（零视觉回归）；
 * ② `absolute` 锚点的偏移不得随尺寸缩放（吊顶 / 壁挂件安装高度回归）；
 * ③ typeBounds 能抓出「几何长轴与 defaultSize 轴向矛盾」的素材缺陷（T2.10i 闸门的底座）。
 */
import { describe, expect, it } from 'vitest';
import type { Component, ComponentType, GeometryPrimitive } from './types';
import {
  instanceMatrixOf,
  instanceScaleRatio,
  isPrimVisibleAt,
  placePrimitive,
  primDims,
  primHalfExtents,
  primLocalMatrix,
  primTriangleBudget,
  primTriangleCount,
  sizeRatio,
  tintPrimColor,
  typeBounds,
  typeSwatchColor,
  visiblePrims,
} from './geometry';
import {
  mat4AlmostEqual,
  mat4Compose,
  mat4Multiply,
  mat4Scaling,
  mat4TransformPoint,
  mat4Translation,
} from './matrix';

/** 造一个最小可用的图元（box，落地居中） */
const box = (
  size: number[],
  offset: Partial<GeometryPrimitive['offset']> = {},
  extra: Partial<GeometryPrimitive> = {},
): GeometryPrimitive => ({
  kind: 'box',
  size,
  offset: { x: offset.x ?? 0, y: offset.y ?? size[1] / 2, z: offset.z ?? 0 },
  ...extra,
});

const typeOf = (
  defaultSize: ComponentType['defaultSize'],
  geometry: GeometryPrimitive[],
): Pick<ComponentType, 'defaultSize' | 'geometry'> => ({ defaultSize, geometry });

const compOf = (size: Component['size']): Pick<Component, 'size'> => ({ size });

describe('primDims（图元三轴跨度）', () => {
  it('box 直接取 [w,h,d]', () => {
    expect(primDims(box([600, 2000, 1000]))).toEqual({ w: 600, h: 2000, d: 1000 });
  });
  it('cylinder 取 [r,h] → 直径 × 高', () => {
    expect(primDims({ kind: 'cylinder', size: [75, 480], offset: { x: 0, y: 260, z: 0 } })).toEqual({
      w: 150,
      h: 480,
      d: 150,
    });
  });
  it('plane 深度为 0（纯面片，v3.9 起为朝 +Z 的竖屏面：size = [w,h]）', () => {
    expect(primDims({ kind: 'plane', size: [600, 600], offset: { x: 0, y: 0, z: 0 } })).toEqual({
      w: 600,
      h: 600,
      d: 0,
    });
  });
  it('sphere 取 [r] → 三轴均为直径（素材 L3 专项）', () => {
    expect(primDims({ kind: 'sphere', size: [60], offset: { x: 0, y: 30, z: 0 } })).toEqual({
      w: 120,
      h: 120,
      d: 120,
    });
  });
  it('cone 取 [r,h] → 直径 × 高（与 cylinder 同口径）', () => {
    expect(primDims({ kind: 'cone', size: [40, 90], offset: { x: 0, y: 45, z: 0 } })).toEqual({
      w: 80,
      h: 90,
      d: 80,
    });
  });
});

describe('primTriangleCount / primTriangleBudget（素材 L3 面数预算口径）', () => {
  it('五种图元的面数与 renderer 分段参数一一对应（漂移由 renderer assets.test.ts 反向锁死）', () => {
    expect(primTriangleCount({ kind: 'box', size: [1, 1, 1], offset: { x: 0, y: 0, z: 0 } })).toBe(12);
    expect(primTriangleCount({ kind: 'plane', size: [1, 1], offset: { x: 0, y: 0, z: 0 } })).toBe(2);
    expect(
      primTriangleCount({ kind: 'cylinder', size: [1, 1], offset: { x: 0, y: 0, z: 0 } }),
    ).toBe(96);
    expect(primTriangleCount({ kind: 'cone', size: [1, 1], offset: { x: 0, y: 0, z: 0 } })).toBe(48);
    expect(primTriangleCount({ kind: 'sphere', size: [1], offset: { x: 0, y: 0, z: 0 } })).toBe(
      720,
    );
  });

  it('类型面数按 LOD 档位统计：near 细节件不计入 far 档', () => {
    const type = typeOf(
      { w: 600, d: 600, h: 600 },
      [
        { kind: 'sphere', size: [100], offset: { x: 0, y: 100, z: 0 } },
        { kind: 'box', size: [100, 100, 100], offset: { x: 0, y: 250, z: 0 }, lod: 'near' },
      ],
    );
    expect(primTriangleBudget(type, 'far')).toBe(720);
    expect(primTriangleBudget(type, 'near')).toBe(732);
  });
});

describe('sizeRatio（FR-M03 尺寸比例）', () => {
  it('实例尺寸 = 默认尺寸 → 三轴恒 1', () => {
    const type = typeOf({ w: 600, d: 1000, h: 2000 }, [box([600, 2000, 1000])]);
    expect(sizeRatio(compOf({ w: 600, d: 1000, h: 2000 }), type)).toEqual({ x: 1, y: 1, z: 1 });
  });
  it('非等比缩放逐轴独立（w-d 手柄语义）', () => {
    const type = typeOf({ w: 600, d: 1000, h: 2000 }, [box([600, 2000, 1000])]);
    expect(sizeRatio(compOf({ w: 1200, d: 500, h: 2000 }), type)).toEqual({
      x: 2,
      y: 1,
      z: 0.5,
    });
  });
  it('defaultSize 某轴为 0 → 该轴回退 1（避免 Infinity 几何）', () => {
    const type = typeOf({ w: 0, d: 1000, h: 2000 }, [box([600, 2000, 1000])]);
    expect(sizeRatio(compOf({ w: 900, d: 1000, h: 2000 }), type).x).toBe(1);
  });
});

describe('placePrimitive（anchor 缩放语义，T2.10e 核心）', () => {
  const ratio = { x: 2, y: 3, z: 0.5 };

  it('ground（缺省）：偏移随尺寸缩放 = 旧 group.scale 行为（零视觉回归）', () => {
    const prim = box([600, 2000, 1000], { x: 0, y: 1000, z: 100 });
    const p = placePrimitive(prim, ratio);
    expect(p.position).toEqual({ x: 0, y: 3000, z: 50 });
    expect(p.scale).toEqual(ratio);
  });

  it('absolute：偏移为绝对安装高度，改尺寸不漂移', () => {
    const prim = box([150, 120, 150], { x: 0, y: 3480, z: 0 }, { anchor: 'absolute' });
    const p = placePrimitive(prim, ratio);
    // 旧实现会给到 3480 × 3 = 10440（飘出天花板）；新语义保持 3480
    expect(p.position.y).toBe(3480);
    expect(p.position).toEqual({ x: 0, y: 3480, z: 0 });
    // 图元自身尺寸仍随实例缩放
    expect(p.scale).toEqual(ratio);
  });

  it('absolute 的水平偏移同样按绝对 mm 处理（贴墙件场景）', () => {
    const prim = box([400, 200, 60], { x: 0, y: 2200, z: 100 }, { anchor: 'absolute' });
    expect(placePrimitive(prim, ratio).position.z).toBe(100);
  });
});

describe('visiblePrims / isPrimVisibleAt（LOD 档位，T2.12 底座）', () => {
  const far = box([100, 100, 100]);
  const near = box([100, 100, 100], {}, { lod: 'near', name: 'handle' });

  it('far 档只渲染常驻图元', () => {
    expect(visiblePrims(typeOf({ w: 1, d: 1, h: 1 }, [far, near]), 'far')).toHaveLength(1);
  });
  it('near 档 = far + near 全量', () => {
    expect(visiblePrims(typeOf({ w: 1, d: 1, h: 1 }, [far, near]), 'near')).toHaveLength(2);
  });
  it('缺省视为 far（旧素材零改动）', () => {
    expect(isPrimVisibleAt(box([1, 1, 1]), 'far')).toBe(true);
    expect(isPrimVisibleAt(near, 'far')).toBe(false);
    expect(isPrimVisibleAt(near, 'near')).toBe(true);
  });
});

describe('typeBounds（几何包围盒：闸门与占地核对底座）', () => {
  it('单落地 box → 与 defaultSize 一致且贴地', () => {
    const b = typeBounds(typeOf({ w: 600, d: 1000, h: 2000 }, [box([600, 2000, 1000])]));
    expect(b.w).toBe(600);
    expect(b.h).toBe(2000);
    expect(b.d).toBe(1000);
    expect(b.minY).toBeCloseTo(0, 6);
  });

  it('多部件取并集（操控台：底座 + 台板）', () => {
    const console = typeBounds(
      typeOf({ w: 1200, d: 800, h: 1200 }, [
        box([1200, 800, 800], { y: 400 }),
        box([1200, 400, 500], { y: 1000, z: 100 }),
      ]),
    );
    expect(console.w).toBe(1200);
    expect(console.h).toBe(1200);
    expect(console.d).toBe(800); // 台板 (z 100±250) 落在底座 (±400) 之内
  });

  it('能抓出「几何长轴写在 d、defaultSize 却记成 h」的素材缺陷（桥架类）', () => {
    const tray = typeBounds(
      typeOf({ w: 300, d: 100, h: 3000 }, [box([300, 100, 3000], { y: 3300 })]),
    );
    // 几何实际是 300 宽 / 100 高 / 3000 长，而 defaultSize 声称 300 宽 / 3000 高 / 100 深
    expect(tray.h).toBe(100);
    expect(tray.d).toBe(3000);
    expect(tray.h).not.toBe(3000);
  });

  it('minY 为负即穿地（闸门断言用）', () => {
    const sunk = typeBounds(typeOf({ w: 600, d: 600, h: 50 }, [box([600, 50, 600], { y: 20 })]));
    expect(sunk.minY).toBeCloseTo(-5, 6);
  });

  it('空几何返回零包围盒（不产生 Infinity）', () => {
    expect(typeBounds(typeOf({ w: 0, d: 0, h: 0 }, []))).toEqual({
      w: 0,
      h: 0,
      d: 0,
      minY: 0,
      maxY: 0,
    });
  });
});

/* ============ tintPrimColor / typeSwatchColor（T2.11 实例色下的逐图元配色） ============ */

const hexRgb = (c: string): { r: number; g: number; b: number } => {
  const n = parseInt(c.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
/** 感知亮度 0~1（与实现同一权重，仅用于断言单调性） */
const lumaOf = (c: string): number => {
  const { r, g, b } = hexRgb(c);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};
/** 色相角（deg），断言「压暗 / 提亮不偏色」用 */
const hueOf = (c: string): number => {
  const { r, g, b } = hexRgb(c);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  const h =
    max === r
      ? (g - b) / d + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  return (h / 6) * 360;
};

describe('tintPrimColor（T2.11 / 产品文档 §10.4）', () => {
  /** it-rack42 实测色板：代表色 body、暗件 vent、亮件 trim、发光件 led */
  const SWATCH = '#CBC7D4';
  const BASE = '#EC6D9A';

  it('无实例色 → undefined（不干预，走图元自色）', () => {
    expect(tintPrimColor(undefined, SWATCH, SWATCH)).toBeUndefined();
  });

  it('图元未标色 → undefined（走主题默认灰回退链）', () => {
    expect(tintPrimColor(BASE, undefined, SWATCH)).toBeUndefined();
  });

  it('图元色 = 代表色 → 严格等于实例色（主图元就是用户选的那支色）', () => {
    expect(tintPrimColor(BASE, SWATCH, SWATCH)).toBe(BASE);
  });

  it('暗件压暗、亮件提亮（精修层次不被单色覆盖抹平）', () => {
    const dark = tintPrimColor(BASE, '#8E88A0', SWATCH)!;
    const light = tintPrimColor(BASE, '#EFEDF4', SWATCH)!;
    expect(lumaOf(dark)).toBeLessThan(lumaOf(BASE));
    expect(lumaOf(light)).toBeGreaterThan(lumaOf(BASE));
    expect(lumaOf(dark)).toBeLessThan(lumaOf(light));
  });

  it('调制不偏色：色相与分量排序跟随实例色（着色语义仍读得出是哪支色）', () => {
    // #EC6D9A 的分量序为 R > B > G；8bit 量化在低彩度 / 深色调上会把色相角放大几度，
    // 故以「分量排序不变」为主断言，色相角给到 15° 容差。
    for (const prim of ['#8E88A0', '#EFEDF4', '#0A0A0A', '#FFFFFF', '#3F8C5A']) {
      const out = tintPrimColor(BASE, prim, SWATCH)!;
      expect(out).toMatch(/^#[0-9A-F]{6}$/);
      const { r, g, b } = hexRgb(out);
      expect(r > b && b > g, `${prim} → ${out}`).toBe(true);
      expect(Math.abs(hueOf(out) - hueOf(BASE))).toBeLessThan(15);
    }
  });

  it('明度比夹在安全区间：极端黑不会糊成一团、极端白不会洗掉主色', () => {
    const darkest = lumaOf(tintPrimColor(BASE, '#000000', SWATCH)!);
    const brightest = lumaOf(tintPrimColor(BASE, '#FFFFFF', SWATCH)!);
    expect(darkest).toBeLessThan(lumaOf(BASE));
    expect(brightest).toBeGreaterThan(lumaOf(BASE));
    expect(darkest).toBeGreaterThan(0.1);
    expect(brightest).toBeLessThan(0.95);
  });

  it('非法 / 缺省色值退回整体覆盖，不抛异常（素材写错不炸视口）', () => {
    expect(tintPrimColor(BASE, 'not-a-color', SWATCH)).toBe(BASE);
    expect(tintPrimColor(BASE, '#8E88A0', 'garbage')).toBe(BASE);
    expect(tintPrimColor('rgb(1,2,3)', '#8E88A0', SWATCH)).toBe('rgb(1,2,3)');
  });

  it('代表色近黑时退回整体覆盖（明度比会爆炸）', () => {
    expect(tintPrimColor(BASE, '#8E88A0', '#010101')).toBe(BASE);
  });

  it('同输入同输出（材质桶键依赖其确定性）', () => {
    const a = tintPrimColor(BASE, '#8E88A0', SWATCH);
    expect(tintPrimColor(BASE, '#8E88A0', SWATCH)).toBe(a);
  });

  it('typeSwatchColor = 主图元色，与渲染层 tint 基准同源', () => {
    expect(
      typeSwatchColor({ geometry: [{ kind: 'box', size: [1, 1, 1], offset: { x: 0, y: 0, z: 0 }, color: SWATCH }] }),
    ).toBe(SWATCH);
    expect(typeSwatchColor({ geometry: [] })).toBeUndefined();
  });
});

/* ============ 图元 / 实例矩阵（T2.10g 批渲染的正确性底座） ============ */

describe('primLocalMatrix / instanceMatrixOf（T2.10g）', () => {
  const IDQ = { x: 0, y: 0, z: 0, w: 1 };
  const ONE = { x: 1, y: 1, z: 1 };

  it('ground 锚点：偏移随尺寸比缩放，结果 = T(offset×ratio) × S(ratio)', () => {
    const prim = box([600, 2000, 1000], { x: 300, y: 1000 });
    const ratio = { x: 2, y: 0.5, z: 4 };
    const m = primLocalMatrix(prim, ratio);
    const expectChain = mat4Multiply(
      mat4Translation(300 * 2, 1000 * 0.5, 0),
      mat4Scaling(ratio.x, ratio.y, ratio.z),
    );
    expect(mat4AlmostEqual(m, expectChain)).toBe(true);
  });

  it('absolute 锚点：偏移是绝对 mm，不随尺寸比缩放（吊顶件安装高度不漂）', () => {
    const prim = box([150, 120, 150], { y: 3480 }, { anchor: 'absolute' });
    const p = mat4TransformPoint(primLocalMatrix(prim, { x: 3, y: 9, z: 3 }), { x: 0, y: 0, z: 0 });
    expect(p.y).toBeCloseTo(3480);
  });

  it('plane 图元是朝 +Z 的竖向屏面：等于 T(pos) × S(ratio)（v3.9 语义修正，无躺平旋转）', () => {
    const prim: GeometryPrimitive = {
      kind: 'plane',
      size: [1000, 2000],
      offset: { x: 0, y: 5, z: 0 },
    };
    const ratio = { x: 2, y: 1, z: 3 };
    const chain = mat4Multiply(mat4Translation(0, 5, 0), mat4Scaling(ratio.x, ratio.y, ratio.z));
    expect(mat4AlmostEqual(primLocalMatrix(prim, ratio), chain)).toBe(true);
    // 竖屏后：局部 +Y（屏高方向）在世界 +Y、局部 +Z 是屏面法线（朝 +Z）
    const edge = mat4TransformPoint(primLocalMatrix(prim, ratio), { x: 0, y: 1, z: 0 });
    expect(edge.y).toBeCloseTo(6);
    expect(edge.z).toBeCloseTo(0);
    const normal = mat4TransformPoint(primLocalMatrix(prim, ratio), { x: 0, y: 0, z: 1 });
    expect(normal.y).toBeCloseTo(5);
    expect(normal.z).toBeCloseTo(3);
  });

  it('instanceScaleRatio = size/defaultSize × comp.scale（FR-M03 与渲染层 ratioOf 同口径）', () => {
    const comp = {
      size: { w: 1200, h: 1000, d: 600 },
      scale: { x: 2, y: 1, z: 1 },
    } as Pick<Component, 'size' | 'scale'>;
    const type = { defaultSize: { w: 600, h: 2000, d: 600 } } as Pick<ComponentType, 'defaultSize'>;
    expect(instanceScaleRatio(comp, type)).toEqual({ x: 4, y: 0.5, z: 1 });
  });

  it('defaultSize 某轴为 0 时该轴比例回退 1（纯平面件不炸成 Infinity）', () => {
    const comp = {
      size: { w: 100, h: 0, d: 100 },
      scale: ONE,
    } as Pick<Component, 'size' | 'scale'>;
    const type = { defaultSize: { w: 100, h: 0, d: 100 } } as Pick<ComponentType, 'defaultSize'>;
    expect(instanceScaleRatio(comp, type)).toEqual(ONE);
  });

  it('世界矩阵 = 位姿 × 局部矩阵：平移是主序、旋转带动偏移做圆周运动', () => {
    const prim = box([600, 2000, 1000], { x: 300, y: 1000 });
    const yaw90 = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
    const at = (q: typeof IDQ) =>
      mat4TransformPoint(
        instanceMatrixOf({ position: { x: 10000, y: 0, z: 5000 }, rotation: q }, prim, ONE),
        { x: 0, y: 0, z: 0 },
      );
    const front = at(IDQ);
    expect([front.x, front.y, front.z]).toEqual([10300, 1000, 5000]);
    const turned = at(yaw90);
    expect(turned.x).toBeCloseTo(10000); // +300 的局部 X 偏移被转成 −Z
    expect(turned.z).toBeCloseTo(4700);
  });

  it('同一实例矩阵连乘与手算链一致（批渲染不会引入第二次变换）', () => {
    const prim = box([600, 2000, 1000], { y: 1000 });
    const comp = { position: { x: 1200, y: 0, z: 3400 }, rotation: IDQ };
    const ratio = { x: 1.2, y: 0.8, z: 1 };
    const chain = mat4Multiply(
      mat4Compose(comp.position, IDQ, ONE),
      primLocalMatrix(prim, ratio),
    );
    expect(mat4AlmostEqual(instanceMatrixOf(comp, prim, ratio), chain)).toBe(true);
  });

  it('primHalfExtents：box 三轴半长、plane 的 Z 半轴为 0（竖屏面）', () => {
    expect(primHalfExtents(box([600, 2000, 1000]))).toEqual({ x: 300, y: 1000, z: 500 });
    expect(
      primHalfExtents({ kind: 'plane', size: [1000, 2000], offset: { x: 0, y: 0, z: 0 } }),
    ).toEqual({ x: 500, y: 1000, z: 0 });
  });
});

