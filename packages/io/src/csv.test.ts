/**
 * CSV 通用层单测（T3.3 / FR-A05）。
 * 锁的是「Excel 打开不乱码、不错列、不把空值当 0」这一类只有真开过报表才知道的坑。
 */
import { describe, expect, it } from 'vitest';
import { escapeCsv, toCsv } from './csv';

describe('escapeCsv', () => {
  it('普通值不加引号', () => {
    expect(escapeCsv('机房')).toBe('机房');
    expect(escapeCsv(115.1)).toBe('115.1');
    expect(escapeCsv(0)).toBe('0');
    expect(escapeCsv(true)).toBe('true');
    expect(escapeCsv(false)).toBe('false');
  });

  it('含逗号 / 引号 / 换行的值整体加引号，内部引号翻倍（RFC4180）', () => {
    expect(escapeCsv('A,B')).toBe('"A,B"');
    expect(escapeCsv('说"你好"')).toBe('"说""你好"""');
    expect(escapeCsv('第一行\n第二行')).toBe('"第一行\n第二行"');
    expect(escapeCsv('混合,"x"')).toBe('"混合,""x"""');
  });

  it('首尾空白会被解析器吞掉，故加引号保住', () => {
    expect(escapeCsv(' 前空格')).toBe('" 前空格"');
    expect(escapeCsv('后空格 ')).toBe('"后空格 "');
  });

  it('null / undefined / 空串 → 空单元格（与「0」严格区分）', () => {
    expect(escapeCsv(null)).toBe('');
    expect(escapeCsv(undefined)).toBe('');
    expect(escapeCsv('')).toBe('');
  });

  it('NaN / Infinity 留空：写进 Excel 会变成文本，合计直接算错', () => {
    expect(escapeCsv(Number.NaN)).toBe('');
    expect(escapeCsv(Number.POSITIVE_INFINITY)).toBe('');
    expect(escapeCsv('NaN')).toBe('NaN'); // 字符串「NaN」是合法文本，照原样导出
  });
});

describe('toCsv', () => {
  const columns = [
    { header: '名称', value: (r: { n: string; w: number }) => r.n },
    { header: '功率(W)', value: (r: { n: string; w: number }) => r.w },
  ];

  it('默认带 UTF-8 BOM 与 CRLF，末行也有换行', () => {
    const out = toCsv(columns, [{ n: 'A 排', w: 8000 }]);
    expect(out.startsWith('\uFEFF')).toBe(true);
    expect(out).toBe('\uFEFF名称,功率(W)\r\nA 排,8000\r\n');
  });

  it('可关 BOM（自研解析器 / 单测比对时更干净）', () => {
    expect(toCsv(columns, [], { bom: false })).toBe('名称,功率(W)\r\n');
  });

  it('表头含逗号也要转义；空行集只出表头', () => {
    const cols = [{ header: '额定,负载', value: () => 1 }];
    expect(toCsv(cols, [], { bom: false })).toBe('"额定,负载"\r\n');
  });

  it('多行：每行一行，顺序与入参一致', () => {
    const out = toCsv(columns, [{ n: 'a', w: 1 }, { n: 'b,2', w: 2 }], { bom: false });
    expect(out.split('\r\n')).toEqual(['名称,功率(W)', 'a,1', '"b,2",2', '']);
  });
});
