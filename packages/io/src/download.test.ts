/**
 * 文件名与下载工具单测（T3.3）。
 * 这些坑都是「在 Windows 上点一次导出才发现」的类型，必须在 CI 里就先撞。
 */
import { describe, expect, it } from 'vitest';
import { dataUrlToBlob, dateStamp, downloadBlob, downloadTextFile, safeFileName } from './download';

describe('safeFileName', () => {
  it('Windows 非法字符逐个换成下划线（工程名里带日期斜杠太常见了）', () => {
    expect(safeFileName('2026/09 机房改造')).toBe('2026_09 机房改造');
    expect(safeFileName('a\\b')).toBe('a_b');
    expect(safeFileName('a:b*c?d"e<f>g|h')).toBe('a_b_c_d_e_f_g_h');
  });

  it('结尾的点与空格会被 Windows 静默丢弃 → 显式去掉；中间的点保留', () => {
    expect(safeFileName('机房.  ')).toBe('机房');
    expect(safeFileName('v1.2.3')).toBe('v1.2.3');
  });

  it('全非法 / 全点 → 回退 fallback，不产出空文件名', () => {
    expect(safeFileName('')).toBe('archview');
    expect(safeFileName('...', 'export')).toBe('export');
    expect(safeFileName('   ')).toBe('archview');
  });

  it('超长截断到 80 字符（避免撞路径总长上限）', () => {
    expect(safeFileName('名'.repeat(120))).toHaveLength(80);
  });
});

describe('dateStamp', () => {
  it('固定日期 → YYYY-MM-DD（个位补零、不含冒号等非法字符）', () => {
    expect(dateStamp(new Date(2026, 8, 3))).toBe('2026-09-03');
    expect(dateStamp(new Date(2026, 0, 7))).toBe('2026-01-07');
  });
});

describe('downloadTextFile / downloadBlob', () => {
  it('非浏览器环境（node 单测）静默跳过而不是抛异常', () => {
    expect(() => downloadTextFile('a.csv', 'x')).not.toThrow();
    expect(() => downloadBlob('a.png', new Blob(['x']))).not.toThrow();
  });
});

describe('dataUrlToBlob（截图下载的必经一步）', () => {
  it('base64 PNG 解成二进制：mime 与字节内容都保持', async () => {
    const pngHead = [0x89, 0x50, 0x4e, 0x47];
    const b64 = btoa(String.fromCharCode(...pngHead));
    const blob = dataUrlToBlob(`data:image/png;base64,${b64}`);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(4);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes]).toEqual(pngHead);
  });

  it('非 base64 的 dataURL 走 URI 解码（%25 → %、%20 → 空格）', async () => {
    const blob = dataUrlToBlob('data:text/plain;charset=utf-8,100%25%20full');
    expect(await blob.text()).toBe('100% full');
  });

  it('mime 缺省回退 text/plain', () => {
    expect(dataUrlToBlob('data:,hello').type).toBe('text/plain');
  });

  it('非法输入抛错，而不是给一个空 Blob 让下载静默变成 0 字节', () => {
    expect(() => dataUrlToBlob('https://example.com/a.png')).toThrow('data URL');
    expect(() => dataUrlToBlob('')).toThrow('data URL');
    expect(() => dataUrlToBlob('data:image/png;base64,@@bad@@')).toThrow(); // atob 自己会抛
  });
});
