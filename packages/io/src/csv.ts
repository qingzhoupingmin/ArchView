/**
 * CSV 导出（T3.3 / FR-A05）：通用的「结构化数据 → CSV 文本」纯函数层。
 *
 * 三条不可省的口径，都来自 Excel 的现实行为而非形式主义：
 * ① **UTF-8 BOM**：缺它时 Excel / WPS 会按本地代码页解析，中文列名直接变成乱码，
 *    而这份报表的受众正是拿 Excel 看的人；
 * ② **CRLF 行分隔**：RFC4180 的规定，也是 Notepad / Excel 对旧 CSV 的兼容底线；
 * ③ **null / undefined → 空单元格**而不是 `0`：统计里「没填实际负载」与「负载为 0」
 *    是两件事（同 core/stats 的 `unmeasured` 口径）。导出一张全 0 的报表，
 *    等于告诉主人「这机房几乎空载」，而真相只是数据没录。
 *
 * 非 ASCII 安全：不依赖 `Intl`、不碰 `toLocaleString`（千分位会破坏 Excel 的列解析）。
 */

/** 单元格允许的值：null / undefined 表示「留空」，与「0」严格区分 */
export type CsvValue = string | number | boolean | null | undefined;

export interface CsvColumn<T> {
  /** 表头文案（中文，Excel 打开即可读） */
  header: string;
  /** 取值：返回 null / undefined 则该格留空 */
  value: (row: T) => CsvValue;
}

/**
 * 按 RFC4180 转义单个单元格。
 * 需要加引号的情形：含逗号 / 双引号 / CR / LF，或首尾带空白（多数解析器会吞空白）。
 * NaN / Infinity 一律留空——把 "NaN" 写进报表，Excel 会当文本处理，合计直接算错。
 */
export function escapeCsv(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
  }
  const s = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
  if (s === '') return '';
  if (/[",\r\n]/.test(s) || s !== s.trim()) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface ToCsvOptions {
  /** 默认带 UTF-8 BOM（Excel 中文必需）；测试或自研解析器可关掉 */
  bom?: boolean;
  /** 行分隔符，默认 CRLF */
  eol?: string;
}

/** 表格 → CSV 文本（含表头行）。纯函数，可在 Node 与浏览器两端同样运行 */
export function toCsv<T>(
  columns: readonly CsvColumn<T>[],
  rows: Iterable<T>,
  opts: ToCsvOptions = {},
): string {
  const { bom = true, eol = '\r\n' } = opts;
  const line = (cells: readonly CsvValue[]): string => cells.map(escapeCsv).join(',');
  const out: string[] = [line(columns.map((c) => c.header))];
  for (const row of rows) out.push(line(columns.map((c) => c.value(row))));
  return (bom ? '\uFEFF' : '') + out.join(eol) + eol;
}
