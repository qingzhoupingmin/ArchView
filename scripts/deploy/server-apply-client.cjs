/**
 * 服务端执行：把本次构建生成的 Prisma Client 覆盖到「运行时真正解析到的位置」。
 *
 * 背景（数据隔离专项·部署固化）：服务器的 node_modules 是首次打包时 `pnpm deploy --prod`
 * 生成的自包含产物，部署只换 dist 并不会带上新生成的客户端 —— 于是代码里
 * `prisma.auditLog` 在服务端是 undefined（新模型根本不存在），运行期才炸。
 * Prisma 5.22 的 `prisma generate` 只写生成产物、不换引擎版本（版本未变即无需换 dll），
 * 所以这里只覆盖 JS / 类型 / schema.prisma，query_engine-*.dll.node 一律不动。
 *
 * 路径不写死：用 require.resolve('@prisma/client') 反推真实目录（本仓库首次部署踩过
 * 「按猜测路径上传 → 改了个没被加载的副本」的坑）。
 *
 * 用法（cwd 必须是 api 根目录）：node server-apply-client.cjs <stageDir> <标记>
 */
const fs = require('node:fs');
const path = require('node:path');

const stage = process.argv[2];
const tag = (process.argv[3] || 'deploy').replace(/[^A-Za-z0-9._-]/g, '_');
if (!stage || !fs.existsSync(stage)) {
  console.log('APPLYCLIENT_FAIL=stage 目录不存在：' + stage);
  process.exit(2);
}

const SKIP = /\.(node|exe|dll)$/i; // 引擎等二进制不覆盖
const entry = require.resolve('@prisma/client');
// .../node_modules/.pnpm/@prisma+client@X/node_modules/@prisma/client/default.js
const pkgDir = path.dirname(entry);
const target = path.resolve(pkgDir, '..', '..', '.prisma', 'client');
if (!fs.existsSync(target)) {
  console.log('APPLYCLIENT_FAIL=找不到生成目录：' + target);
  process.exit(3);
}
console.log('APPLYCLIENT_RESOLVED=' + entry);
console.log('APPLYCLIENT_TARGET=' + target);

const before = new Set(fs.readdirSync(target));
let copied = 0;
let backed = 0;
for (const name of fs.readdirSync(stage)) {
  if (SKIP.test(name)) continue;
  const from = path.join(stage, name);
  if (!fs.statSync(from).isFile()) continue;
  const to = path.join(target, name);
  if (before.has(name)) {
    fs.copyFileSync(to, to + '.pre-' + tag + '.bak');
    backed++;
  }
  fs.copyFileSync(from, to);
  copied++;
}
console.log('APPLYCLIENT_COPIED=' + copied + ' BACKED_UP=' + backed);

// 关键校验：目标 schema 必须已经包含最新模型（否则等于白刷）
const schema = fs.readFileSync(path.join(target, 'schema.prisma'), 'utf8');
const models = [...schema.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]);
console.log('APPLYCLIENT_MODELS=' + models.join(','));
console.log('APPLYCLIENT_OK');
