/**
 * 浏览器端文件下载与文件名清洗（T3.3 起 CSV / 工程文件 / 截图共用）。
 *
 * 单独一层的原因：导出这件事的坑都在「浏览器与文件系统」这一侧——
 * objectURL 不释放就是每次导出泄漏一个 Blob；工程名直接进文件名则会在
 * Windows 上炸出「无法创建文件」（`\ / : * ? " < > |` 都是非法字符，
 * 而「2026/09 机房改造」这种工程名再自然不过）。
 */

/**
 * 清洗成安全文件名：非法字符换成 `_`，去掉结尾的点与空格（Windows 会静默丢弃它们，
 * 导致「机房.」保存成「机房」而对不上号），超长按 80 字截断。
 */
export function safeFileName(name: string, fallback = 'archview'): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  return (cleaned === '' ? fallback : cleaned).slice(0, 80);
}

/** `2026-09-03` —— 导出文件名用日期后缀（不含冒号，跨平台安全） */
export function dateStamp(d: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 触发一次文本文件下载。
 * BOM 不在此处添加：toCsv 已把 BOM 写进内容，重复添加会让 Excel 首格多出一个
 * 不可见的零宽字符（U+FEFF）：肉眼看不见，但公式与字符串匹配全会错位。
 * 非浏览器环境（node 单测）静默跳过，不抛异常。
 */
export function downloadTextFile(
  filename: string,
  text: string,
  mime = 'text/plain;charset=utf-8',
): void {
  triggerDownload(filename, new Blob([text], { type: mime }));
}

/** 内部：Blob → 落盘。objectURL 用后必 revoke，否则每次导出泄漏一个 Blob */
function triggerDownload(filename: string, blob: Blob): void {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 下载任意 Blob（截图 PNG 与将来的打包导出共用）；非浏览器环境静默跳过 */
export function downloadBlob(filename: string, blob: Blob): void {
  triggerDownload(filename, blob);
}

/**
 * dataURL → Blob（截图走这条路下载，而非 `a.href = dataURL`）。
 * 原因：DataURL 直链长度受浏览器限制，一张高分辨率截图的 base64 很容易超，
 * 而超限的表现是**点了没反应**——最难查的那类静默失败。
 * node（≥16）也有 atob / Blob，故本函数可完整单测。
 *
 * 参数段（`;base64` / `;charset=utf-8`）按「包含 base64 才算二进制」判定，
 * 不能写成 `(;base64)?,` 这种严格式——`data:text/plain;charset=utf-8,` 是完全合法的写法，
 * 严格式会把带 charset 的 URL 整条判成非法（本函数曾因此挂过一条用例）。
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]*)([^,]*),([\s\S]*)$/.exec(dataUrl);
  if (!m) throw new Error('不是合法的 data URL');
  const mime = m[1] || 'text/plain';
  const params = m[2] ?? '';
  const body = m[3] ?? '';
  if (params.includes('base64')) {
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(body)], { type: mime });
}
