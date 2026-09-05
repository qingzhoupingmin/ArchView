/**
 * 主题 token 同源单测（产品文档 §10.2 原则 3「UI 与 3D 共用同一套 token」）。
 *
 * 背景：同一组色值手写在两处——tokens.css（UI 层）与 tokens.ts（three.js 渲染层）。
 * P2 曾把 --color-text-muted 从 #9B93A7（对比度 3.0:1）改到 #6F6879（5.3:1）以满足 WCAG AA，
 * 却漏改 tokens.ts，导致 UI 与 3D 静默漂移。本文件把「同源」从注释约定升级为 CI 闸门。
 *
 * 另锁两条契约：
 *  1. 视口天空 / 地面 / 次网格 / 主网格的相对亮度必须逐级拉开——防止为了「更淡更粉」
 *     把空间参照又抹平（§10.4，P3 截图反馈「看着空、不像 3D」的直接原因）。
 *  2. 关键前景色达 WCAG AA，防止后续调色把 a11y 改回退。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  HEX_TOKENS,
  MAT_PRESETS,
  MAT_SLOTS,
  COLOR_PRIMARY_DEEP,
  COLOR_TEXT_MUTED,
  VP_COMPONENT_DEFAULT,
  VP_SKY_BOTTOM,
  VP_GROUND,
  VP_GRID,
  VP_GRID_MAJOR,
  VP_HORIZON,
} from './tokens';
import type { MatParams } from './tokens';

/** 例：'VP_GRID_MAJOR' → '--vp-grid-major' */
const cssVarOf = (tsName: string) => '--' + tsName.toLowerCase().replace(/_/g, '-');

/** 读同目录文件文本（tokens.css / tokens.ts 源码） */
const readSibling = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

let cachedRootBlock: string | null = null;

/**
 * 取 tokens.css 的 :root 主块并剥去注释。
 * 只取主块：暗色分支 `:root[data-theme='dark'] {` 有意覆盖部分变量，不参与 TS 镜像校验
 * （渲染层暂不跟随主题切换，见 tokens.css 暗色段注释与排期 T4.4）。
 */
function rootBlock(): string {
  if (cachedRootBlock) return cachedRootBlock;
  const cleaned = readSibling('tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const at = cleaned.indexOf(':root {');
  if (at < 0) throw new Error('tokens.css 中找不到 :root { 主块');
  const end = cleaned.indexOf('\n}', at);
  cachedRootBlock = cleaned.slice(at, end < 0 ? cleaned.length : end);
  return cachedRootBlock;
}

/** 解析 :root 主块内的 6 位十六进制色值变量 */
function cssHexVars(): Map<string, string> {
  const map = new Map<string, string>();
  const block = rootBlock();
  const re = /(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g;
  for (let m = re.exec(block); m !== null; m = re.exec(block)) {
    map.set(m[1], m[2].toUpperCase());
  }
  return map;
}

/**
 * 扫描 tokens.ts 源码，提取所有 `export const NAME = '#RRGGBB'`。
 * 走源码而非运行时枚举 module namespace：vitest 下 namespace 对象的 key 枚举不可靠，
 * 曾导致「TS → CSS 方向」的比对空转假绿。
 */
function tsHexNamesInSource(): string[] {
  const src = readSibling('tokens.ts').replace(/\/\*[\s\S]*?\*\//g, '');
  const names: string[] = [];
  const re = /export const ([A-Z][A-Z0-9_]*)\s*=\s*'(#[0-9a-fA-F]{6})'/g;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) names.push(m[1]);
  return names;
}

/** sRGB 相对亮度（WCAG 2.x）：0 = 黑，1 = 白 */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const s = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

describe('主题 token 同源（§10.2 原则 3）', () => {
  it('HEX_TOKENS 登记表无漏：源码里每个色常量都已登记', () => {
    const inSource = tsHexNamesInSource();
    const registered = Object.keys(HEX_TOKENS);
    expect(inSource.length, '源码扫描失效应立刻暴露').toBeGreaterThan(16);
    expect(
      inSource.filter((n) => !registered.includes(n)),
      '漏登记进 HEX_TOKENS',
    ).toEqual([]);
    expect(
      registered.filter((n) => !inSource.includes(n)),
      'HEX_TOKENS 登记了不存在的常量',
    ).toEqual([]);
  });

  it('tokens.ts 的每个色常量都能在 tokens.css :root 找到同值变量', () => {
    const css = cssHexVars();
    const drift: string[] = [];
    for (const [name, value] of Object.entries(HEX_TOKENS)) {
      const varName = cssVarOf(name);
      const cssValue = css.get(varName);
      if (cssValue === undefined) drift.push(`${name}: CSS 缺少 ${varName}`);
      else if (cssValue !== value.toUpperCase())
        drift.push(`${name}: TS=${value} ≠ CSS ${varName}=${cssValue}`);
    }
    expect(drift, 'UI 与渲染层 token 漂移：\n' + drift.join('\n')).toEqual([]);
  });

  it('tokens.css 的每个十六进制色变量都有 tokens.ts 镜像（防只加一边）', () => {
    const tsNames = new Set(Object.keys(HEX_TOKENS).map(cssVarOf));
    const orphans = [...cssHexVars().keys()].filter((v) => !tsNames.has(v));
    expect(orphans, '以下 CSS 色变量缺 TS 镜像：' + orphans.join(', ')).toEqual([]);
  });

  it('视口新 token 已双侧落地', () => {
    expect(cssHexVars().has('--vp-grid-major')).toBe(true);
    expect(cssHexVars().has('--vp-horizon')).toBe(true);
    expect(HEX_TOKENS.VP_GRID_MAJOR).toBeDefined();
    expect(HEX_TOKENS.VP_HORIZON).toBeDefined();
  });
});

describe('视口明度层次（§10.4 空间参照）', () => {
  it('天空底 > 地面 > 次网格 > 主网格，逐级亮度差 ≥ 0.08', () => {
    const steps: Array<[string, string, string]> = [
      ['天空底 / 地面', VP_SKY_BOTTOM, VP_GROUND],
      ['地面 / 次网格', VP_GROUND, VP_GRID],
      ['次网格 / 主网格', VP_GRID, VP_GRID_MAJOR],
    ];
    for (const [label, lighter, darker] of steps) {
      expect(
        luminance(lighter) - luminance(darker),
        `${label} 亮度差不足，视口会糊成一片、失去空间参照`,
      ).toBeGreaterThanOrEqual(0.08);
    }
  });

  it('地面描边比主网格更深，保证地板边界可见', () => {
    expect(luminance(VP_GRID_MAJOR) - luminance(VP_HORIZON)).toBeGreaterThanOrEqual(0.03);
  });

  it('视口色保持低饱和暖灰粉调（不跑色）', () => {
    for (const [name, hex] of Object.entries({ VP_SKY_BOTTOM, VP_GROUND, VP_GRID, VP_HORIZON })) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${name} 饱和度过高`).toBeLessThanOrEqual(40);
      expect(r, `${name} 应偏暖（R ≥ G）`).toBeGreaterThanOrEqual(g);
    }
  });
});

describe('文本对比度（P2 a11y 回归）', () => {
  it('--color-text-muted 在白底达 WCAG AA 小字 4.5:1', () => {
    const ratio = 1.05 / (luminance(COLOR_TEXT_MUTED) + 0.05);
    expect(ratio, `旧值 #9B93A7 仅 3.0:1，当前 ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  it('主按钮深粉在白底达 WCAG AA', () => {
    expect(1.05 / (luminance(COLOR_PRIMARY_DEEP) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * 材质档契约（S2.5 / T2.10c，产品文档 §10.4）：
 * 六档是「平涂 + 光学参数分级」，不是贴图库；档位集合必须与 core 的 MaterialSlot 一致
 * （编译期由渲染层 Record 索引兜底，此处锁数值表现与旧实现零回归）。
 */
describe('材质档预设 MAT_PRESETS（§10.4 六档）', () => {
  const SLOTS = ['matte', 'metal', 'glass', 'grille', 'emissive', 'rubber'] as const;

  it('六档齐全且无多余档位（与 core MaterialSlot 同集合）', () => {
    expect([...MAT_SLOTS].sort()).toEqual([...SLOTS].sort());
  });

  it('所有参数落在 0~1 区间（越界会让 three.js 出非物理结果）', () => {
    const bad: string[] = [];
    for (const slot of SLOTS) {
      const p: MatParams = MAT_PRESETS[slot];
      for (const key of ['roughness', 'metalness', 'opacity', 'emissive'] as const) {
        if (!(p[key] >= 0 && p[key] <= 1)) bad.push(`${slot}.${key}=${p[key]}`);
      }
    }
    expect(bad, '材质参数越界：' + bad.join(', ')).toEqual([]);
  });

  it('matte 缺省档等于旧实现表现（旧素材零回归）', () => {
    expect(MAT_PRESETS.matte).toEqual({ roughness: 0.85, metalness: 0.05, opacity: 1, emissive: 0 });
  });

  it('只有 glass / grille 档是半透明（避免误设导致视口穿帮）', () => {
    const translucent = SLOTS.filter((s) => MAT_PRESETS[s].opacity < 1);
    expect(translucent).toEqual(['glass', 'grille']);
  });

  it('emissive 是唯一自发光档（指示灯 / 显示屏用）', () => {
    expect(MAT_PRESETS.emissive.emissive).toBeGreaterThan(0);
    expect(SLOTS.filter((s) => s !== 'emissive').every((s) => MAT_PRESETS[s].emissive === 0)).toBe(true);
  });

  it('金属档比默认档更亮更反射，橡胶档最哑光（档位间必须有可感知差异）', () => {
    expect(MAT_PRESETS.metal.metalness).toBeGreaterThan(MAT_PRESETS.matte.metalness);
    expect(MAT_PRESETS.metal.roughness).toBeLessThan(MAT_PRESETS.matte.roughness);
    expect(MAT_PRESETS.rubber.roughness).toBeGreaterThan(MAT_PRESETS.matte.roughness);
  });

  it('设备默认色仍是浅灰（视口平涂基调不变，§10.2）', () => {
    expect(VP_COMPONENT_DEFAULT).toBe('#D8D5DE');
  });
});
