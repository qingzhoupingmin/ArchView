import type { CsvColumn } from '@archview/io';

/**
 * 性能基线报告的行与导出（S2.0d / T3.6，开发计划 §8）。
 *
 * 单独成模块的两个理由，都不是洁癖：
 * ① 页面文件 FpsBaselinePage.tsx 一 import 就会拉起 `@archview/renderer` → three.js，
 *    而这里的逻辑是纯字符串拼装、本该在 node 里直接断言；
 * ② 报告列在**页面表格 / Markdown 复制 / CSV 下载**三处要用同一份定义，
 *    各写一份的话，迟早出现「CSV 比页面多一列」这种对不上账的报表。
 */

/** 一行采样结果 */
export interface ReportRow {
  scenario: string;
  /**
   * 本行采样时生效的三档组合（合批 / 阴影 / 细节）。
   * v3.7 补：此前报告行**不记档位**，而一轮基线要跑 16 格（四档 × 开/关批 × 开/关阴影），
   * 四行混在一张表里根本分不清哪行属于哪组 URL——抄进 §S2.0d 表必然错位，
   * 而「表格里有一行不知道是什么条件跑出来的」等于整轮白跑。
   */
  mode: string;
  components: number;
  calls: number;
  /** 实例桶数（T2.10g）：开批时 = 单通道 draw call 上限；关批时为 0 */
  buckets: number;
  triangles: number;
  idleMin: number;
  idleAvg: number;
  orbitMin: number;
  orbitAvg: number;
  verdict: string;
}

/** 报告列顺序（页面 thead、Markdown 表头、CSV 表头三处同源） */
export const REPORT_COLUMNS = [
  '场景',
  '档位',
  '组件',
  '绘制调用',
  '实例桶',
  '三角形',
  '静止 min/avg',
  '环绕 min/avg',
  '判定',
] as const;

/** 一行报告 → 与 REPORT_COLUMNS 同序的单元格数组 */
export function reportCells(r: ReportRow): string[] {
  return [
    r.scenario,
    r.mode,
    String(r.components),
    String(r.calls),
    r.buckets > 0 ? String(r.buckets) : '—',
    `${(r.triangles / 1000).toFixed(1)}k`,
    `${r.idleMin} / ${r.idleAvg}`,
    `${r.orbitMin} / ${r.orbitAvg}`,
    r.verdict,
  ];
}

/**
 * 报告 → GitHub Markdown 表格（直接粘进开发计划 §4.2 S2.0d 记录表）。
 * 单元格里的 `|` 必须转义，否则场景名一带竖线就把整列切歪——
 * 而 Markdown 表格歪掉是**看不出来**的，只会静默多一列少一列。
 */
export function reportMarkdown(rows: ReportRow[]): string {
  const esc = (s: string): string => s.replace(/\|/g, '\\|');
  const head = '| ' + REPORT_COLUMNS.join(' | ') + ' |';
  const sep =
    '| ' +
    REPORT_COLUMNS.map((c) => (c === '场景' || c === '档位' ? '---' : '---:')).join(' | ') +
    ' |';
  const body = rows.map((r) => '| ' + reportCells(r).map(esc).join(' | ') + ' |');
  return [head, sep, ...body].join('\n');
}

/** 报告 → CSV 列定义（交给 io 层的 toCsv：BOM + CRLF + RFC4180） */
export const REPORT_CSV_COLUMNS: CsvColumn<ReportRow>[] = REPORT_COLUMNS.map((header, i) => ({
  header,
  value: (r: ReportRow) => reportCells(r)[i],
}));
