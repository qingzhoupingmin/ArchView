/**
 * 内置组件素材闸门（S2.5 / T2.10i，开发计划 §6「素材」规范 + 产品文档 §6.5.1 / §7）：
 * 把「素材能不能用」从口头约定变成可执行断言，防止素材回涨压垮帧率、或再出现
 * 「几何长轴与 defaultSize 轴向矛盾」这类静默缺陷（2026-09-02 实测曾命中 3 项）。
 *
 * 与设计文档的对应：
 *  - 图元预算：产品文档 §7「`far` 档 ≤ 8 图元 / 型」→ PRIM_BUDGET_FAR
 *  - 材质档：core MaterialSlot 与 theme MAT_PRESETS 同集合 → material 合法性
 *  - 子部件名：L2 语义级素材（同组件内唯一）
 *  - anchor：绝对安装高度不得随尺寸缩放（§8.2-11 ②）
 */
import { describe, expect, it } from 'vitest';
import {
  primBudgetCount,
  primDims,
  primTriangleBudget,
  typeBounds,
  visiblePrims,
  type ComponentType,
  type GeometryPrimitive,
} from '@archview/core';
import { componentTypes } from './index';

/** `far` 档图元预算（产品文档 §7）：超出即视为压垮 1000 组件帧率的风险改动 */
export const PRIM_BUDGET_FAR = 8;

/** 绝对安装高度合理区间（mm）：低于 1.2m 不算壁挂、高于 3.58m 穿透 3600 层高吊顶 */
const ABSOLUTE_Y_MIN = 1200;
const ABSOLUTE_Y_MAX = 3580;

/** 尺寸一致性容差：取 max(50mm, 5%)，吸收 1U=44.45→44.5 一类取整与堆叠件留缝 */
const near = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(50, b * 0.05);

const items = componentTypes as ComponentType[];

describe('素材闸门：尺寸与包围盒（T2.10i）', () => {
  it('几何包围盒与 defaultSize 三轴一致（抓「长轴写进 d、defaultSize 记成 h」类缺陷）', () => {
    const bad = items
      .map((t) => {
        const b = typeBounds(t);
        const off: string[] = [];
        if (!near(b.w, t.defaultSize.w)) off.push(`w 几何${b.w} vs 声明${t.defaultSize.w}`);
        if (!near(b.h, t.defaultSize.h)) off.push(`h 几何${b.h} vs 声明${t.defaultSize.h}`);
        if (!near(b.d, t.defaultSize.d)) off.push(`d 几何${b.d} vs 声明${t.defaultSize.d}`);
        return off.length ? `${t.id}(${t.name})：${off.join('、')}` : null;
      })
      .filter((x): x is string => x !== null);
    expect(bad, '尺寸声明与几何矛盾：\n' + bad.join('\n')).toEqual([]);
  });

  it('图元不穿地（minY ≥ -1mm）', () => {
    const sunk = items.filter((t) => typeBounds(t).minY < -1).map((t) => t.id);
    expect(sunk, '以下组件几何插入地面：' + sunk.join(', ')).toEqual([]);
  });

  it('每个组件至少 1 个图元、且 `far` 档常驻图元非空（否则放置后视口不可见）', () => {
    const empty = items.filter((t) => t.geometry.length === 0 || visiblePrims(t, 'far').length === 0);
    expect(empty.map((t) => t.id), '存在无可渲染图元的组件').toEqual([]);
  });
});

describe('素材闸门：图元预算（产品文档 §7）', () => {
  it(`far 档图元数 ≤ ${PRIM_BUDGET_FAR}（超出会击穿 1000 组件帧率预算）`, () => {
    const over = items
      .map((t) => ({ id: t.id, n: primBudgetCount(t, 'far') }))
      .filter((x) => x.n > PRIM_BUDGET_FAR);
    expect(over, `以下组件 far 档图元超限：${over.map((x) => `${x.id}=${x.n}`).join(', ')}`).toEqual([]);
  });

  it('near 档（近景 / 漫游 / 出图）总数 ≤ 40', () => {
    const over = items.filter((t) => t.geometry.length > 40).map((t) => t.id);
    expect(over, '以下组件总图元数超 40：' + over.join(', ')).toEqual([]);
  });
});

describe('素材闸门：材质档与子部件语义（L1 / L2 口径）', () => {
  const SLOTS = ['matte', 'metal', 'glass', 'grille', 'emissive', 'rubber'];

  it('material 取值合法（六档之一，与 core MaterialSlot / theme MAT_PRESETS 同集合）', () => {
    const bad: string[] = [];
    for (const t of items) {
      for (const p of t.geometry) {
        if (p.material !== undefined && !SLOTS.includes(p.material)) {
          bad.push(`${t.id}.${p.name ?? '?'}=${p.material}`);
        }
      }
    }
    expect(bad, '非法材质档：' + bad.join(', ')).toEqual([]);
  });

  it('name 在同一组件内唯一（拾取 / U 位 / 剖切按名寻址的前提）', () => {
    const dup: string[] = [];
    for (const t of items) {
      const names = t.geometry.map((p) => p.name).filter((n): n is string => !!n);
      if (new Set(names).size !== names.length) dup.push(t.id);
    }
    expect(dup, '子部件名重复：' + dup.join(', ')).toEqual([]);
  });

  it('多部件组件（≥ 2 图元）必须逐图元命名（否则无法定位是哪个部件出问题）', () => {
    const missing = items
      .filter((t) => t.geometry.length >= 2)
      .filter((t) => t.geometry.some((p) => !p.name))
      .map((t) => t.id);
    expect(missing, '多部件组件存在无名图元：' + missing.join(', ')).toEqual([]);
  });

  it('emissive 档必须自带颜色（自发光色取自图元色）', () => {
    const bad = items
      .flatMap((t) => t.geometry.map((p) => ({ id: t.id, p })))
      .filter((x) => x.p.material === 'emissive' && !x.p.color)
      .map((x) => x.id);
    expect(bad, 'emissive 图元缺 color：' + bad.join(', ')).toEqual([]);
  });

  it('半透明档（glass / grille）不投射阴影（薄件投影会出漂浮碎影）', () => {
    const bad = items
      .flatMap((t) => t.geometry.map((p) => ({ id: t.id, p })))
      .filter((x) => (x.p.material === 'glass' || x.p.material === 'grille') && x.p.castShadow !== false)
      .map((x) => `${x.id}.${x.p.name ?? '?'}`);
    expect(bad, '半透明图元仍在投影：' + bad.join(', ')).toEqual([]);
  });
});

describe('素材闸门：安装高度语义（§8.2-11 ②）', () => {
  it('anchor=absolute 的图元落在壁挂 / 吊顶高度区间内', () => {
    const bad: string[] = [];
    for (const t of items) {
      for (const p of t.geometry) {
        if (p.anchor !== 'absolute') continue;
        if (p.offset.y < ABSOLUTE_Y_MIN || p.offset.y > ABSOLUTE_Y_MAX) {
          bad.push(`${t.id}.${p.name ?? '?'} y=${p.offset.y}`);
        }
      }
    }
    expect(bad, '绝对安装高度越界：' + bad.join(', ')).toEqual([]);
  });

  it('anchor=absolute 不得被误标在落地居中图元上（offset.y 不应等于自身半高）', () => {
    const wrong = items
      .flatMap((t) => t.geometry.map((p) => ({ id: t.id, p })))
      .filter((x) => x.p.anchor === 'absolute')
      .filter((x) => {
        const h = x.p.kind === 'box' ? x.p.size[1] : x.p.kind === 'cylinder' ? x.p.size[1] : 0;
        return Math.abs(x.p.offset.y - h / 2) < 1;
      })
      .map((x) => `${x.id}.${x.p.name ?? '?'}`);
    expect(wrong, '落地件被误标 absolute：' + wrong.join(', ')).toEqual([]);
  });

  it('绝对安装高度件（吊顶 / 壁挂）一律关投影', () => {
    const bad = items
      .flatMap((t) => t.geometry.map((p) => ({ id: t.id, p })))
      .filter((x) => x.p.anchor === 'absolute' && x.p.castShadow !== false)
      .map((x) => `${x.id}.${x.p.name ?? '?'}`);
    expect(bad, '吊顶 / 壁挂件仍在投射阴影：' + bad.join(', ')).toEqual([]);
  });
});

/* ============ T2.11 素材精修专项（开发计划 §4.2 S2.5 C 段） ============ */

/** L2 语义级 6 项：必须带下列子部件名（U 位 FR-D03 / 剖切 FR-V04 / 通道着色 FR-V06 的寻址锚点） */
const L2_REQUIRED_NAMES: Record<string, string[]> = {
  'it-rack42': ['door', 'vent', 'rail-l', 'rail-r', 'led', 'foot'],
  'it-rack47': ['door', 'vent', 'rail-l', 'rail-r', 'led', 'foot'],
  'rack-glass': ['frame', 'glass', 'handle', 'led', 'foot'],
  'rack-mesh': ['vent', 'rail-l', 'rail-r', 'led'],
  'rack-modular': ['cover', 'plinth', 'end-w', 'end-e', 'roof', 'door'],
  'power-row-pdu': ['base', 'door', 'vent', 'panel'],
};

/** L1 识别级 6 项（清单同 C 段） */
const L1_TYPES = ['power-ups', 'ac-precision', 'ac-floor', 'cooling-ac', 'space-floor', 'space-door'];

/**
 * 阴影体积下限（m³）：低于此值的薄壳 / 细条件（门板、导轨、压条、U 位条、接管、喷头…）
 * 投影只产出贴地碎影，却在阴影通道里各占一次 draw call（成本 ×2）——一律显式 `castShadow: false`。
 * 口径与开发计划 §4.2 S2.5 D 段「小体积件关投影」一致。
 */
const SHADOW_MIN_VOLUME_M3 = 0.08;

/** 图元包围盒体积（m³）；plane 深度恒 0 故体积 0，必然落进「关投影」一侧 */
function primVolumeM3(prim: GeometryPrimitive): number {
  const { w, h, d } = primDims(prim);
  return (w * h * d) / 1e9;
}

/**
 * 全库 `far` 档图元总量预算（draw call 代理指标）。
 * 实例化（T2.10g）落地前每多一个 far 图元 ≈ 每实例多一次 draw call（含阴影通道 ×2），
 * 故把「总量」而非只有「单型 ≤ 8」钉死。
 * 素材 L3 专项（v3.8）：定向精修预计新增 55~65 个 far 图元，230 → 300 重定基线；
 * 「完整桶数口径」随 T5.0c 切换（面数账由下方 `PRIM_TRI_BUDGET_*` 先行承担）。
 */
export const PRIM_BUDGET_FAR_TOTAL = 300;

/**
 * 全库 `far` 档三角面总量（L3 面数预算，v3.8 新增）。
 * 面数才是显存与顶点吞吐的真账：38 项精修后实测 4320，批次 2/3 的球 / 锥预计 +12~14k，
 * 20000 留足余量——超出说明有组件在堆高面数图元（一个 sphere = 720 面），该立专项了。
 */
export const PRIM_TRI_BUDGET_FAR_TOTAL = 20000;

/**
 * 单类型 `far` 档三角面上限（L3 面数预算，v3.8 新增）。
 * 现状单型最大 312（fire-gas-cabinet）；精修后最重的件（双球罩摄像头 / 多阀件消防件）
 * 预计 ≤ 2500。3000 咬合「一个类型最多 4 个 sphere」——再重就该拆 near 档或等 glTF 了。
 */
export const PRIM_TRI_BUDGET_FAR_PER_TYPE = 3000;

describe('素材闸门：T2.11 精修识别度与总量预算（产品文档 §6.5.1 / §7）', () => {
  it(`全库 far 档图元总数 ≤ ${PRIM_BUDGET_FAR_TOTAL}（实例化前的 draw call 总闸）`, () => {
    const total = items.reduce((n, t) => n + primBudgetCount(t, 'far'), 0);
    expect(total, `全库 far 档图元总数 ${total} 超预算`).toBeLessThanOrEqual(PRIM_BUDGET_FAR_TOTAL);
  });

  it(`全库 far 档三角面总数 ≤ ${PRIM_TRI_BUDGET_FAR_TOTAL}（L3 面数总闸）`, () => {
    const total = items.reduce((n, t) => n + primTriangleBudget(t, 'far'), 0);
    expect(total, `全库 far 档三角面总数 ${total} 超预算`).toBeLessThanOrEqual(
      PRIM_TRI_BUDGET_FAR_TOTAL,
    );
  });

  it(`单型 far 档三角面 ≤ ${PRIM_TRI_BUDGET_FAR_PER_TYPE}（防单类型堆高面数图元）`, () => {
    const over = items
      .map((t) => ({ id: t.id, n: primTriangleBudget(t, 'far') }))
      .filter((x) => x.n > PRIM_TRI_BUDGET_FAR_PER_TYPE);
    expect(
      over,
      `以下组件 far 档面数超限（sphere = 720 面，考虑拆 near 档或等 glTF）：` +
        over.map((x) => `${x.id}=${x.n}`).join(', '),
    ).toEqual([]);
  });

  it('高频 12 项已脱离 L0 单盒：far 档 ≥ 3 图元且 ≥ 2 个材质档', () => {
    const weak = Object.keys(L2_REQUIRED_NAMES)
      .concat(L1_TYPES)
      .map((id) => items.find((t) => t.id === id))
      .filter((t): t is ComponentType => !!t)
      .filter((t) => {
        const far = visiblePrims(t, 'far');
        return far.length < 3 || new Set(far.map((p) => p.material ?? 'matte')).size < 2;
      })
      .map((t) => t.id);
    expect(weak, '以下高频件未达 L1 识别级：' + weak.join(', ')).toEqual([]);
  });

  it('L2 六项的 far 档必含约定子部件名（防「只堆 box 不写真名」的假精修）', () => {
    const bad: string[] = [];
    for (const [id, names] of Object.entries(L2_REQUIRED_NAMES)) {
      const t = items.find((x) => x.id === id);
      if (!t) {
        bad.push(`${id} 缺失`);
        continue;
      }
      const has = new Set(visiblePrims(t, 'far').map((p) => p.name));
      const miss = names.filter((n) => !has.has(n));
      if (miss.length) bad.push(`${id} 缺 ${miss.join('/')}`);
    }
    expect(bad, 'L2 子部件名不齐：' + bad.join('；')).toEqual([]);
  });

  it('near 档细节件必须显式标 lod=near 且关投影（不得混进 far 常驻集）', () => {
    const bad = items
      .flatMap((t) => t.geometry.map((p) => ({ id: t.id, p })))
      .filter((x) => x.p.lod === 'near' && x.p.castShadow !== false)
      .map((x) => `${x.id}.${x.p.name ?? '?'}`);
    expect(bad, '近景细节件仍在投射阴影：' + bad.join(', ')).toEqual([]);
  });

  it('高频 12 项中 ≥ 8 项带 near 细节件（T2.12 升档必须肉眼可见，不做空壳接线）', () => {
    const withNear = Object.keys(L2_REQUIRED_NAMES)
      .concat(L1_TYPES)
      .filter((id) => items.find((t) => t.id === id)?.geometry.some((p) => p.lod === 'near'));
    expect(
      withNear.length,
      `带 near 细节件的高频件仅 ${withNear.length} 项（< 8）：` + withNear.join(', '),
    ).toBeGreaterThanOrEqual(8);
  });

  it('near 细节件不得混进 far 常驻集（far 计数 = 总数 − near 数）', () => {
    const bad = items
      .map((t) => ({
        id: t.id,
        delta:
          t.geometry.length -
          primBudgetCount(t, 'far') -
          t.geometry.filter((p) => p.lod === 'near').length,
      }))
      .filter((x) => x.delta !== 0);
    expect(bad, 'far / near 计数不闭合：' + bad.map((x) => x.id).join(', ')).toEqual([]);
  });

  it('主图元（首位 = 类型代表色来源）必须自带 color', () => {
    const bad = items.filter((t) => !t.geometry[0]?.color).map((t) => t.id);
    expect(bad, '以下组件主图元缺 color，属性面板代表色会回退默认灰：' + bad.join(', ')).toEqual([]);
  });

  it(`薄壳 / 细条件（体积 < ${SHADOW_MIN_VOLUME_M3} m³）必须显式关投影（T2.11 D 段）`, () => {
    const bad = items.flatMap((t) =>
      t.geometry
        .filter((p) => p.castShadow !== false && primVolumeM3(p) < SHADOW_MIN_VOLUME_M3)
        .map((p) => `${t.id}.${p.name ?? '?'}`),
    );
    expect(bad, '小体积件仍在投射阴影（阴影通道 draw call ×2 且只出碎影）：' + bad.join(', ')).toEqual(
      [],
    );
  });
});

/* ============ 素材 L3 专项批次 2（v3.9 · 17 项弱件重做） ============ */

/**
 * 17 项弱件白名单：v3.8 复核认定的「2~3 个 far 图元 + 纯盒堆」组件（摄像头 / 消防 / 通道 / 屏类 / 单材质件）。
 * 批次 2 重做后的验收线：**far 档必含 ≥1 非 box 图元且 ≥2 材质档**——
 * 这是「不再是集合体」的机器可验口径：至少一个球 / 锥 / 圆柱 / 屏面词汇件 + 至少两档材质。
 */
const L3_WEAK_TYPES = [
  'other-camera',
  'camera-dome',
  'camera-bullet',
  'camera-ptz',
  'other-smoke',
  'fire-sprinkler',
  'fire-extinguisher',
  'other-access',
  'smart-tv',
  'smart-data-wall',
  'fire-sign',
  'fire-emergency-light',
  'cooling-cold-aisle',
  'cooling-hot-aisle',
  'electrical-light-switch',
  'smart-water-rope',
  'furniture-console',
];

describe('素材闸门：L3 弱件重做（A-4 批次 2）', () => {
  it('白名单 17 项齐备（防 ID 漂移导致断言空转）', () => {
    const missing = L3_WEAK_TYPES.filter((id) => !items.some((t) => t.id === id));
    expect(missing, '弱件白名单 ID 不在内置库：' + missing.join(', ')).toEqual([]);
  });

  it('17 项弱件已脱离盒堆：far 档必含 ≥1 非 box 图元且 ≥2 材质档', () => {
    const bad = L3_WEAK_TYPES.map((id) => items.find((t) => t.id === id))
      .filter((t): t is ComponentType => !!t)
      .filter((t) => {
        const far = visiblePrims(t, 'far');
        const hasNonBox = far.some((p) => p.kind !== 'box');
        const mats = new Set(far.map((p) => p.material ?? 'matte'));
        return !hasNonBox || mats.size < 2;
      })
      .map((t) => t.id);
    expect(bad, '以下弱件仍是盒堆（缺非 box 图元或材质档 < 2）：' + bad.join(', ')).toEqual([]);
  });
});

/* ============ 素材 L3 专项批次 3（v3.11 · 纯 box 高频件升级） ============ */

/**
 * 批次 3 白名单：v3.8 认定的「纯 box 高频件」——批次 3 逐型升级后的验收线：
 * ① far 档 ≥ 2 材质档（单档 = 整块同光泽，仍读作「集合体」）；
 * ② 关键结构件到位（机房门圆柱把手 / 四边门框、数据大屏 4×4 拼缝、挂机屏面为 plane）。
 */
const L3_BATCH3_TYPES = [
  'smart-data-wall',
  'electrical-panel-light',
  'ac-wall',
  'space-door',
  'cable-tray',
  'electrical-tray-trough',
  'electrical-tray-mesh',
  'furniture-file-cabinet',
];

describe('素材闸门：L3 纯 box 高频件升级（A-4 批次 3）', () => {
  it('白名单 8 项齐备（防 ID 漂移导致断言空转）', () => {
    const missing = L3_BATCH3_TYPES.filter((id) => !items.some((t) => t.id === id));
    expect(missing, '批次 3 白名单 ID 不在内置库：' + missing.join(', ')).toEqual([]);
  });

  it('8 项已分层：far 档 ≥ 2 材质档', () => {
    const bad = L3_BATCH3_TYPES.map((id) => items.find((t) => t.id === id))
      .filter((t): t is ComponentType => !!t)
      .filter((t) => new Set(visiblePrims(t, 'far').map((p) => p.material ?? 'matte')).size < 2)
      .map((t) => t.id);
    expect(bad, '以下高频件 far 档仍单材质档：' + bad.join(', ')).toEqual([]);
  });

  it('机房门：把手升级为圆柱且门框四边齐备', () => {
    const t = items.find((x) => x.id === 'space-door');
    const far = t ? visiblePrims(t, 'far') : [];
    const handle = far.find((p) => p.name === 'handle');
    const frameSides = ['frame-l', 'frame-r', 'frame-top', 'frame-bottom'].filter((n) =>
      far.some((p) => p.name === n),
    );
    expect(handle?.kind, '机房门把手应为圆柱').toBe('cylinder');
    expect(frameSides, '机房门门框缺边：' + frameSides.length + '/4').toHaveLength(4);
  });

  it('数据大屏：4×4 拼屏（6 条拼缝 + emissive 屏面）', () => {
    const t = items.find((x) => x.id === 'smart-data-wall');
    const far = t ? visiblePrims(t, 'far') : [];
    const seams = far.filter((p) => p.name?.startsWith('seam-'));
    const screen = far.find((p) => p.name === 'screen');
    expect(seams, '拼缝应为 6 条（3 竖 + 3 横）').toHaveLength(6);
    expect(screen?.kind, '大屏屏面应为 plane').toBe('plane');
  });

  it('挂机：显示屏面为 plane 屏面且带前面板双色调', () => {
    const t = items.find((x) => x.id === 'ac-wall');
    const far = t ? visiblePrims(t, 'far') : [];
    const display = far.find((p) => p.name === 'display');
    const panel = far.find((p) => p.name === 'panel');
    expect(display?.kind, '挂机显示屏应为 plane').toBe('plane');
    expect(panel, '挂机缺前面板').toBeTruthy();
  });
});

