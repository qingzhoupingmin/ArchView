/**
 * 电力统计报表 → CSV（T3.3 / FR-A05）。
 *
 * 三层混排一张表（机房 / 排 / 机柜，带「上级」列），而不是拆三个文件：
 * Excel 里按「层级」列一筛就是任意一级，跨级对比也不用来回开三个表。
 * 数字一律以 kW 两位小数导出（160000 W → 160.00，无损），利用率导出百分数**数值**
 * 而不带 % 号——带上百分号 Excel 会当文本处理，合计与图表全部失效。
 */
import type { ProjectPower } from '@archview/core';
import { toCsv, type CsvColumn } from './csv';

/** 报表行：机房 / 排 / 机柜三级的统一形状 */
export interface PowerReportRow {
  /** 层级：机房 | 排 | 未成排 | 机柜 */
  level: string;
  name: string;
  /** 上一级名称（机房行的上级为空） */
  parent: string;
  count: number;
  /** kW；null = 该格留空 */
  ratedKW: number | null;
  loadKW: number | null;
  /** 百分数数值（71.94 表示 71.94%）；null = 无额定容量，留空而不是写 0 */
  loadPct: number | null;
  unmeasured: number;
}

/** W → kW 两位小数（无损且 Excel 可直接比较求和） */
function toKW(w: number): number {
  return Math.round((w / 1000) * 100) / 100;
}

const COLUMNS: readonly CsvColumn<PowerReportRow>[] = [
  { header: '层级', value: (r) => r.level },
  { header: '名称', value: (r) => r.name },
  { header: '上级', value: (r) => r.parent },
  { header: '台数', value: (r) => r.count },
  { header: '额定功率(kW)', value: (r) => r.ratedKW },
  { header: '实际负载(kW)', value: (r) => r.loadKW },
  { header: '容量利用率(%)', value: (r) => r.loadPct },
  { header: '未填负载台数', value: (r) => r.unmeasured },
];

/**
 * 展平三级数据为报表行。
 * `withUnits=false` 只出机房 + 排两级（面板上「导出汇总」用短表，避免上千行柜明细）。
 */
export function powerReportRows(
  stats: ProjectPower,
  projectName: string,
  opts: { withUnits?: boolean } = {},
): PowerReportRow[] {
  const withUnits = opts.withUnits ?? true;
  const out: PowerReportRow[] = [];
  const rate = (r: number | null): number | null => (r === null ? null : Math.round(r * 10000) / 100);

  out.push({
    level: '机房',
    name: projectName,
    parent: '',
    count: stats.project.count,
    ratedKW: toKW(stats.project.ratedW),
    loadKW: toKW(stats.project.loadW),
    loadPct: rate(stats.project.loadRate),
    unmeasured: stats.project.unmeasured,
  });
  for (const row of stats.rows) {
    const isLoose = row.rowId === null;
    out.push({
      level: isLoose ? '未成排' : '排',
      name: row.name,
      parent: projectName,
      count: row.count,
      ratedKW: toKW(row.ratedW),
      loadKW: toKW(row.loadW),
      loadPct: rate(row.loadRate),
      unmeasured: row.unmeasured,
    });
    if (!withUnits) continue;
    for (const u of row.units) {
      out.push({
        level: '机柜',
        name: u.name,
        parent: row.name,
        count: 1,
        ratedKW: toKW(u.ratedW),
        loadKW: toKW(u.loadW),
        // 单台没填负载 → 利用率留空（写 0.00% 就是「这台柜很空」的假象）
        loadPct: u.ratedW > 0 && u.measured ? Math.round((u.loadW / u.ratedW) * 10000) / 100 : null,
        unmeasured: u.measured ? 0 : 1,
      });
    }
  }
  return out;
}

/** 统计报表 CSV（含表头 + UTF-8 BOM + CRLF） */
export function powerReportCsv(
  stats: ProjectPower,
  projectName: string,
  opts: { withUnits?: boolean } = {},
): string {
  return toCsv(COLUMNS, powerReportRows(stats, projectName, opts));
}
