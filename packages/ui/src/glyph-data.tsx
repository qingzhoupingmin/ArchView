import { type ReactNode } from 'react';

/**
 * 组件图形资产表（视口/UI 拆分 Phase 6 自 ComponentGlyph.tsx 分离）。
 *
 * 这个文件里只有**数据**：一张 55 个图形的 SVG 路径表 + typeId / category 两级映射。
 * 它不参与渲染、不含逻辑（除了 resolve 那一行查表），所以新增组件图形时只动这里，
 * 组件本体保持稳定。与 component-lib/data/components.json 的一致性由
 * componentGlyph.test.ts 校验，漏登记会直接报错。
 */

export type ComponentGlyphName =
  /* 空间 */
  | 'floor'
  | 'wall'
  | 'door'
  /* IT */
  | 'rack'
  | 'rack-net'
  | 'server'
  | 'switch'
  /* 电力 */
  | 'dist'
  | 'pdu-row'
  | 'pdu'
  | 'ups'
  | 'battery'
  /* 制冷 */
  | 'ac'
  | 'aisle'
  /* 线缆 */
  | 'tray'
  /* 其它 */
  | 'sprinkler'
  | 'smoke'
  | 'access'
  | 'camera'
  /* T2.9 新增（家具 / 消防 / 电气 / 机柜 / 智能化） */
  | 'desk'
  | 'table'
  | 'console'
  | 'cabinet'
  | 'sofa'
  | 'extinguisher'
  | 'sign'
  | 'emergency-light'
  | 'panel-light'
  | 'light-switch'
  | 'modular'
  | 'rope'
  | 'sensor'
  | 'screen'
  | 'generic';

export const GLYPHS: Record<ComponentGlyphName, ReactNode> = {
  /* ---------- 空间 ---------- */
  /* 架空地板砖：等轴菱形面 + 十字格缝 */
  floor: (
    <>
      <path d="M3 12 12 7l9 5-9 5-9-5Z" />
      <path d="M7.5 9.5 16.5 14.5" />
      <path d="M16.5 9.5 7.5 14.5" />
    </>
  ),
  /* 墙体段：长条 + 砖缝 */
  wall: (
    <>
      <rect x="3" y="8" width="18" height="8" rx="1" />
      <path d="M3 12h18" />
      <path d="M9 8v4" />
      <path d="M15 12v4" />
    </>
  ),
  /* 机房门：门框 + 开启弧 + 把手 */
  door: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="1" />
      <path d="M15 12a3.5 3.5 0 0 0-3.5-3.5" />
      <path d="M13.6 12h.01" />
    </>
  ),

  /* ---------- IT ---------- */
  /* 服务器机柜（42U / 47U 同形，靠卡片上的尺寸文字区分）：柜体 + 设备缝 + 底座 */
  rack: (
    <>
      <rect x="6" y="2.5" width="12" height="19" rx="1.5" />
      <path d="M8.5 6.5h7" />
      <path d="M8.5 9.5h7" />
      <path d="M8.5 12.5h7" />
      <path d="M9.5 17.5h5" />
    </>
  ),
  /* 网络机柜：柜体 + 配线架 + 下出线 */
  'rack-net': (
    <>
      <rect x="6" y="4" width="12" height="16" rx="1.5" />
      <path d="M8.5 8h7" />
      <path d="M8.5 11h7" />
      <path d="M12 14v4" />
      <path d="M10 18h4" />
    </>
  ),
  /* U 位服务器（1U / 2U / 4U 同形）：扁机身 + 状态灯 + 面板 */
  server: (
    <>
      <rect x="2.5" y="9" width="19" height="6.5" rx="1" />
      <path d="M5.5 12.25h.01" />
      <path d="M8 12.25h.01" />
      <path d="M11 12.25h7" />
    </>
  ),
  /* 核心交换机：机身 + 一排端口 */
  switch: (
    <>
      <rect x="2.5" y="9.5" width="19" height="5" rx="1" />
      <path d="M6 11v2" />
      <path d="M9 11v2" />
      <path d="M12 11v2" />
      <path d="M15 11v2" />
      <path d="M18 11v2" />
    </>
  ),
  /* ---------- 电力 ---------- */
  /* 配电柜：柜体 + 闪电 */
  dist: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M13.5 6.5 9.5 13h2.8l-1.3 4.5L15 11h-2.8l1.3-4.5Z" />
    </>
  ),
  /* 列头柜（列 PDU）：柜体 + 多路开关 + 总表 */
  'pdu-row': (
    <>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M8 6.5h8" />
      <path d="M8 9.5h8" />
      <path d="M8 12.5h8" />
      <circle cx="12" cy="17" r="1.6" />
    </>
  ),
  /* 机柜 PDU（立式）：细长条 + 一列插孔 */
  pdu: (
    <>
      <rect x="9.5" y="2.5" width="5" height="19" rx="1" />
      <path d="M11.2 6h1.6" />
      <path d="M11.2 9h1.6" />
      <path d="M11.2 12h1.6" />
      <path d="M11.2 15h1.6" />
    </>
  ),
  /* UPS：机身 + 输出波形 */
  ups: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
      <path d="M6.5 12h1.8l1.4-2.8 2 5.6 1.4-2.8h4" />
    </>
  ),
  /* 电池组：电芯分隔 + 正极柱 */
  battery: (
    <>
      <rect x="3" y="8" width="15.5" height="9" rx="1.2" />
      <path d="M21 11v3" />
      <path d="M8 8v9" />
      <path d="M13.5 8v9" />
    </>
  ),

  /* ---------- 制冷 ---------- */
  /* 行级精密空调：机身 + 雪花 */
  ac: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M12 7.5v9" />
      <path d="M8.4 9.75 15.6 14.25" />
      <path d="M15.6 9.75 8.4 14.25" />
    </>
  ),
  /* 通道封闭板（冷 / 热通道同形）：拱形顶板 + 立柱 */
  aisle: (
    <>
      <path d="M4 18V9.5a8 8 0 0 1 16 0V18" />
      <path d="M4 18h16" />
      <path d="M9 18V9.5" />
      <path d="M15 18V9.5" />
    </>
  ),

  /* ---------- 线缆 ---------- */
  /* 顶部走线架：梯框 + 横档 */
  tray: (
    <>
      <path d="M3.5 8h17l-2 9h-13l-2-9Z" />
      <path d="M8.5 8v9" />
      <path d="M15.5 8v9" />
    </>
  ),
  /* ---------- 其它 ---------- */
  /* 气体灭火喷头：喷嘴 + 扩散锥 */
  sprinkler: (
    <>
      <circle cx="12" cy="6.5" r="2.8" />
      <path d="M12 9.3v2.2" />
      <path d="M6.5 19c1.6-2.6 3.4-3.9 5.5-3.9s3.9 1.3 5.5 3.9" />
    </>
  ),
  /* 烟感探测器：底座环 + 感应窗 + 进烟孔 */
  smoke: (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 5.5V3.5" />
      <path d="M18.5 12h2" />
    </>
  ),
  /* 门禁读卡器：读卡面板 + 门框 + 感应波 */
  access: (
    <>
      <rect x="3" y="7" width="10.5" height="10" rx="1.5" />
      <path d="M6 11h4.5" />
      <path d="M17 4v16" />
      <path d="M20 9.5a5 5 0 0 1 0 5" />
    </>
  ),
  /* 监控摄像头：机身 + 镜头 + 吊架 */
  camera: (
    <>
      <path d="M3.5 9 15 5.5l2 6.5L5.5 15.5 3.5 9Z" />
      <path d="M17.5 9.5h3.5" />
      <path d="M9 14.8V19h4" />
    </>
  ),
  /* ---------- T2.9 新增 ---------- */
  /* 员工工位：桌面 + 桌腿 + 显示器 */
  desk: (
    <>
      <rect x="2.5" y="9.5" width="19" height="2" rx="0.5" />
      <path d="M5.5 11.5V19" />
      <path d="M18.5 11.5V19" />
      <rect x="9" y="3.5" width="6" height="4.5" rx="0.5" />
    </>
  ),
  /* 会议桌 / 茶几：椭圆桌面 + 桌腿 */
  table: (
    <>
      <ellipse cx="12" cy="8" rx="9" ry="3" />
      <path d="M6.5 10.5V19" />
      <path d="M17.5 10.5V19" />
      <path d="M4.5 19h15" />
    </>
  ),
  /* 操控台：底座柜 + 上挑操作台 + 控制点 */
  console: (
    <>
      <rect x="3.5" y="9.5" width="10" height="10" rx="0.5" />
      <path d="M3.5 9.5 12 6.5l8 2.5-2 3.5" />
      <circle cx="7" cy="13.5" r="0.9" />
      <circle cx="7" cy="16.5" r="0.9" />
    </>
  ),
  /* 文件柜：柜体 + 三层抽屉 + 拉手 */
  cabinet: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="1" />
      <path d="M6 9h12" />
      <path d="M6 15h12" />
      <path d="M10.5 6h3" />
      <path d="M10.5 12h3" />
      <path d="M10.5 18h3" />
    </>
  ),
  /* 沙发：靠背 + 扶手座面 + 支脚 */
  sofa: (
    <>
      <path d="M5 10V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" />
      <path d="M3 18v-3.5A1.5 1.5 0 0 1 4.5 13H8a2 2 0 0 1 2 2v1.5h4V15a2 2 0 0 1 2-2h3.5A1.5 1.5 0 0 1 21 14.5V18Z" />
      <path d="M5 18v1.5" />
      <path d="M19 18v1.5" />
    </>
  ),
  /* 灭火器：瓶体 + 压把 + 标签线 */
  extinguisher: (
    <>
      <rect x="8.5" y="8" width="7" height="12" rx="2" />
      <path d="M12 8V6" />
      <path d="M9.5 6h5" />
      <path d="M12 6l3.5-2" />
      <path d="M10.5 12.5h3" />
    </>
  ),
  /* 指示牌：牌面 + 疏散箭头 */
  sign: (
    <>
      <rect x="3.5" y="7" width="17" height="10" rx="1" />
      <path d="M6.5 12h7" />
      <path d="M11 9.5 13.5 12 11 14.5" />
    </>
  ),
  /* 应急灯：灯体 + 出光 */
  'emergency-light': (
    <>
      <rect x="5" y="8" width="14" height="6" rx="1.5" />
      <path d="M12 14v2" />
      <path d="M8 15l-1.5 2" />
      <path d="M16 15l1.5 2" />
    </>
  ),
  /* 格栅灯：灯盘 + 格栅 */
  'panel-light': (
    <>
      <rect x="3.5" y="8" width="17" height="8" rx="1" />
      <path d="M7.5 8v8" />
      <path d="M12 8v8" />
      <path d="M16.5 8v8" />
    </>
  ),
  /* 灯开关：面板 + 翘板 */
  'light-switch': (
    <>
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
      <path d="M12 9.5v5" />
    </>
  ),
  /* 模块化机房：罩体 + 双模块 + 机架缝 */
  modular: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="1" />
      <path d="M12 4v16" />
      <path d="M6.5 8.5h2.5" />
      <path d="M6.5 12h2.5" />
      <path d="M6.5 15.5h2.5" />
      <path d="M15 8.5h2.5" />
      <path d="M15 12h2.5" />
      <path d="M15 15.5h2.5" />
    </>
  ),
  /* 水浸探测绳：双股绳 */
  rope: (
    <>
      <path d="M3 9c3 3 6-3 9 0s6 3 9 0" />
      <path d="M3 15c3 3 6-3 9 0s6 3 9 0" />
    </>
  ),
  /* 温度传感器：机身 + 表盘 + 刻度 */
  sensor: (
    <>
      <rect x="7" y="3.5" width="10" height="17" rx="1.5" />
      <circle cx="12" cy="10" r="2.6" />
      <path d="M12 10l1.6-1.6" />
      <path d="M9.5 16.5h5" />
    </>
  ),
  /* 数据大屏 / 电视：屏体 + 支架 + 曲线 */
  screen: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="1" />
      <path d="M12 16.5V19" />
      <path d="M8.5 19h7" />
      <path d="M6.5 13.5l3-3.5 2.5 2 3.5-3" />
    </>
  ),
  /* 未知分类的终极兜底：等轴立方体 */
  generic: (
    <>
      <path d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3Z" />
      <path d="M4 7.5 12 12l8-4.5" />
      <path d="M12 12v9" />
    </>
  ),
};

/**
 * typeId → 图形。与 component-lib/data/components.json 的 id 一一对应，
 * 由 componentGlyph.test.ts 校验两侧不漂移（新增组件漏登记会直接报错）。
 */
export const GLYPH_BY_TYPE_ID: Record<string, ComponentGlyphName> = {
  'space-floor': 'floor',
  'space-wall': 'wall',
  'space-door': 'door',
  'it-rack42': 'rack',
  'it-rack47': 'rack',
  'it-net-rack': 'rack-net',
  'it-1u': 'server',
  'it-2u': 'server',
  'it-4u': 'server',
  'it-core-switch': 'switch',
  'power-dist': 'dist',
  'power-row-pdu': 'pdu-row',
  'power-cabinet-pdu': 'pdu',
  'power-ups': 'ups',
  'power-battery': 'battery',
  'cooling-ac': 'ac',
  'cooling-cold-aisle': 'aisle',
  'cooling-hot-aisle': 'aisle',
  'cable-tray': 'tray',
  'other-gas-spray': 'sprinkler',
  'other-smoke': 'smoke',
  'other-access': 'access',
  'other-camera': 'camera',
  /* T2.9 空调（复用 ac 图形） */
  'ac-wall': 'ac',
  'ac-floor': 'ac',
  'ac-precision': 'ac',
  /* T2.9 办公家具 */
  'furniture-workstation': 'desk',
  'furniture-meeting-table': 'table',
  'furniture-console': 'console',
  'furniture-file-cabinet': 'cabinet',
  'furniture-coffee-table': 'table',
  'furniture-sofa': 'sofa',
  /* T2.9 消防新增 */
  'fire-sprinkler': 'sprinkler',
  'fire-gas-cabinet': 'dist',
  'fire-extinguisher': 'extinguisher',
  'fire-sign': 'sign',
  'fire-emergency-light': 'emergency-light',
  /* T2.9 电气新增 */
  'electrical-dist-wall': 'dist',
  'electrical-panel-light': 'panel-light',
  'electrical-light-switch': 'light-switch',
  'electrical-tray-trough': 'tray',
  'electrical-tray-mesh': 'tray',
  /* T2.9 机柜 */
  'rack-modular': 'modular',
  'rack-glass': 'rack',
  'rack-mesh': 'rack',
  /* T2.9 智能化新增 */
  'camera-dome': 'camera',
  'camera-bullet': 'camera',
  'camera-ptz': 'camera',
  'smart-water-rope': 'rope',
  'smart-temp-sensor': 'sensor',
  'access-face': 'access',
  'smart-data-wall': 'screen',
  'smart-tv': 'screen',
};

/** 分类兜底：社区新增组件即使没登记 typeId，也有说得过去的图形，不再出现空心框 */
export const GLYPH_BY_CATEGORY: Record<string, ComponentGlyphName> = {
  space: 'floor',
  it: 'rack',
  power: 'dist',
  cooling: 'ac',
  cable: 'tray',
  other: 'generic',
  /* T2.9 新增 6 类兜底 */
  ac: 'ac',
  furniture: 'table',
  fire: 'smoke',
  electrical: 'dist',
  rack: 'rack',
  smart: 'camera',
};

/** 解析一个组件类型该用哪个图形（typeId 优先，其次 category，最后通用立方体） */
export function resolveComponentGlyph(typeId: string, category?: string): ComponentGlyphName {
  return GLYPH_BY_TYPE_ID[typeId] ?? GLYPH_BY_CATEGORY[category ?? ''] ?? 'generic';
}
