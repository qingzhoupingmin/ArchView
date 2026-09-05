/**
 * ArchView 品牌位图生成器（pnpm brand:favicon）
 *
 * 为什么需要它：public/favicon.svg 是页签图标的首选，但旧版 Edge / IE 与部分桌面快捷方式
 * 只认 .ico，iOS 桌面图标只认 png —— 所以需要位图兜底。而项目不引入任何图像库（sharp / resvg
 * 都是重依赖），故这里用「SDF + 4x 超采样」自己画，并用 node 内置 zlib 手写 PNG 编码器。
 *
 * 关键约束：几何与色值一律从 public/favicon.svg 解析，脚本内不重复定义任何数字——
 * 改了 logo 只需重跑本脚本，页签 SVG 与 ico/png 永不脱节。
 *
 * 产物：favicon.ico（16/32/48 三档）· favicon-32.png · favicon-180.png
 * 用法：pnpm brand:favicon
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const publicDir = join(repoRoot, 'apps', 'web', 'public');
const SRC = join(publicDir, 'favicon.svg');

/* ---------------------------------------------- 1) 解析唯一真源 */
const svg = readFileSync(SRC, 'utf8');

function need(match, what) {
  if (!match) throw new Error('favicon.svg 解析失败：' + what);
  return match;
}

const vb = need(/viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg), 'viewBox');
const CANVAS = Number(vb[1]);
if (Number(vb[2]) !== CANVAS) throw new Error('本页仅支持正方形画布');

const r = need(
  /<rect\s+x="(-?[\d.]+)"\s+y="(-?[\d.]+)"\s+width="([\d.]+)"\s+height="([\d.]+)"\s+rx="([\d.]+)"/.exec(
    svg,
  ),
  'rect 底板（x y width height rx 顺序须固定）',
);
const PLATE = { cx: +r[1] + +r[3] / 2, cy: +r[2] + +r[4] / 2, hw: +r[3] / 2, hh: +r[4] / 2, rx: +r[5] };

const g = need(
  /<linearGradient[^>]*x1="([\d.]+)"[^>]*y1="([\d.]+)"[^>]*x2="([\d.]+)"[^>]*y2="([\d.]+)"/.exec(svg),
  'linearGradient 轴向',
);
const AXIS = { x1: +g[1], y1: +g[2], x2: +g[3], y2: +g[4] };

const stopHexes = [...svg.matchAll(/stop-color="#([0-9A-Fa-f]{6})"/g)].map((m) => m[1]);
if (stopHexes.length !== 2) throw new Error('需要且只需两个 stop-color');
const C0 = hex(stopHexes[0]);
const C1 = hex(stopHexes[1]);
const INK = hex(need(/stroke="#([0-9A-Fa-f]{6})"/.exec(svg), '描边字色')[1]);

const SW = Number(need(/stroke-width="([\d.]+)"/.exec(svg), 'stroke-width')[1]);

/** 折线集合：每条 path 解析成点列（本脚本只支持 M / L 绝对坐标，够用且不会歧义） */
const POLYLINES = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => parsePoly(m[1]));
if (!POLYLINES.length) throw new Error('没找到任何 path');

function hex(s) {
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function parsePoly(d) {
  const letters = d.match(/[A-Za-z]/g) ?? [];
  if (letters.some((c) => c !== 'M' && c !== 'L')) {
    throw new Error('path 只支持 M/L 绝对指令：' + d);
  }
  const nums = d.match(/-?[\d.]+/g) ?? [];
  if (nums.length !== letters.length * 2) throw new Error('path 坐标数不匹配：' + d);
  const pts = [];
  for (let i = 0; i < nums.length; i += 2) pts.push([+nums[i], +nums[i + 1]]);
  return pts;
}

/* ---------------------------------------------- 2) 距离场 */
/** 圆角矩形 SDF（p 相对中心）：负 = 在内 */
function sdBox(px, py) {
  // 圆角矩形 SDF（Inigo Quilez 形式）：q = |p| - b + r —— 半宽必须先内缩一个 r 再加回 r，
  // 漏掉这个 r 会把整张画布算成「都在底板内」，图标糊成一坨粉方块。
  const qx = Math.abs(px) - PLATE.hw + PLATE.rx;
  const qy = Math.abs(py) - PLATE.hh + PLATE.rx;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - PLATE.rx;
}

function sdSegment(px, py, a, b) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = px - a[0];
  const wy = py - a[1];
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return Math.hypot(wx - t * vx, wy - t * vy);
}

/** 笔画 SDF：round cap / round join 的描边就是「到折线的距离 - 半宽」 */
function sdInk(px, py) {
  let best = Infinity;
  for (const pts of POLYLINES) {
    for (let i = 0; i + 1 < pts.length; i++) best = Math.min(best, sdSegment(px, py, pts[i], pts[i + 1]));
    if (pts.length === 1) best = Math.min(best, Math.hypot(px - pts[0][0], py - pts[0][1]));
  }
  return best - SW / 2;
}

/* ---------------------------------------------- 3) 光栅化（4x 超采样 + 1px 过渡带） */
const SS = 4;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function render(target) {
  const px = new Uint8ClampedArray(target * target * 4);
  const s = CANVAS / target; // 目标像素 → 画布单位
  const ax = AXIS.x2 - AXIS.x1;
  const ay = AXIS.y2 - AXIS.y1;
  const alen2 = ax * ax + ay * ay || 1;
  let opaque = 0;

  for (let ty = 0; ty < target; ty++) {
    for (let tx = 0; tx < target; tx++) {
      let boxCov = 0;
      let inkCov = 0;
      let gx = 0;
      let gy = 0;
      for (let i = 0; i < SS; i++) {
        for (let j = 0; j < SS; j++) {
          const cx = (tx + (j + 0.5) / SS) * s;
          const cy = (ty + (i + 0.5) / SS) * s;
          boxCov += clamp(0.5 - (sdBox(cx - PLATE.cx, cy - PLATE.cy) / s), 0, 1);
          inkCov += clamp(0.5 - (sdInk(cx, cy) / s), 0, 1);
          gx += cx;
          gy += cy;
        }
      }
      boxCov /= SS * SS;
      inkCov /= SS * SS;
      const t = clamp((((gx / SS / SS - AXIS.x1) * ax + (gy / SS / SS - AXIS.y1) * ay) / alen2), 0, 1);
      const mix = (k) => C0[k] + (C1[k] - C0[k]) * t;
      const o = (ty * target + tx) * 4;
      px[o] = Math.round(mix(0) + (INK[0] - mix(0)) * inkCov);
      px[o + 1] = Math.round(mix(1) + (INK[1] - mix(1)) * inkCov);
      px[o + 2] = Math.round(mix(2) + (INK[2] - mix(2)) * inkCov);
      px[o + 3] = Math.round(boxCov * 255);
      if (boxCov > 0.5) opaque++;
    }
  }
  return { data: px, coverage: opaque / (target * target) };
}
/* ---------------------------------------------- 4) PNG 编码（node:zlib 手写，无新依赖） */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const tailCrc = Buffer.alloc(4);
  tailCrc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, tailCrc]);
}

/** RGBA 位图 → PNG（8bit / truecolour+alpha / filter 0 逐行存储后 deflate） */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = size * 4;
  const raw = Buffer.alloc(size * (1 + stride));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + stride)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (1 + stride) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------- 5) ICO 容器（PNG-in-ICO，Vista+ 全支持） */
function encodeIco(images) {
  const dir = Buffer.alloc(6 + images.length * 16);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2); // type = icon
  dir.writeUInt16LE(images.length, 4);
  let offset = dir.length;
  images.forEach((img, i) => {
    const o = 6 + i * 16;
    const edge = img.size >= 256 ? 0 : img.size; // 0 在 ICO 语义里就是 256
    dir[o] = edge;
    dir[o + 1] = edge;
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bitcount
    dir.writeUInt32LE(img.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += img.png.length;
  });
  return Buffer.concat([dir, ...images.map((img) => img.png)]);
}

/* ---------------------------------------------- 6) 主流程 */
function write(name, buf) {
  writeFileSync(join(publicDir, name), buf);
  return String(buf.length).padStart(7) + ' B  ' + name;
}

const report = [];
const icoImages = [];
for (const size of [16, 32, 48, 180]) {
  const { data, coverage } = render(size);
  const png = encodePng(size, data);
  const note = '不透明占比 ' + (coverage * 100).toFixed(1) + '%';
  if (size !== 180) icoImages.push({ size, png });
  if (size === 32) report.push(write('favicon-32.png', png) + '   ' + note);
  if (size === 180) report.push(write('favicon-180.png', png) + '   ' + note);
}
const ico = encodeIco(icoImages);
report.push(write('favicon.ico', ico) + '   内含 ' + icoImages.map((i) => i.size + 'px').join(' / '));

console.log('favicon.svg → ' + CANVAS + ' viewBox · 底板 rx=' + PLATE.rx + ' · 描边 ' + SW + ' · 笔画 ' + POLYLINES.length + ' 条');
for (const line of report) console.log('  ' + line);
console.log('完成：品牌位图已写入 apps/web/public/');