/**
 * 服务端执行：启动前的「客户端 ↔ 数据库」一致性自检（数据隔离专项·部署固化）。
 *
 * 要拦的事故：新 dist 上了、库没迁移 → 一查 `Project.version` / `AuditLog` 就崩；
 * 或反过来库迁了、预生成客户端没刷新 → `prisma.auditLog` 是 undefined。
 * 这两种都属「代码与库结构不同步」，起服务前一次原始 SQL 比对就能确定地拦住，
 * 比让 svc-node 起来后在日志里炸要省命得多。
 *
 * 用法（cwd 必须是 api 根目录，才解析得到 @prisma/client）：
 *   node server-selfcheck.cjs <env文件路径> [期望已应用的迁移名...]
 * 只读：不写任何一行数据；只打印非敏感信息（表名 / 迁移名 / 行数）。
 */
const fs = require('node:fs');
const path = require('node:path');

const envFile = process.argv[2];
const expected = process.argv.slice(3);
const fail = (msg) => {
  console.log('SELFCHK_FAIL=' + msg);
  process.exit(1);
};
if (!envFile || !fs.existsSync(envFile)) fail('找不到 env 文件：' + envFile);

const env = {};
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
if (!env.DATABASE_URL) fail('env 里没有 DATABASE_URL');
console.log('SELFCHK_ENV_FILE=' + envFile);
console.log('SELFCHK_DB=' + path.basename(String(env.DATABASE_URL).replace(/^file:/, '')));

// 客户端里声明的模型 = 代码期望存在的表（从生成的 schema.prisma 解析，不猜）
const clientEntry = require.resolve('@prisma/client');
const generatedSchema = path.resolve(path.dirname(clientEntry), '..', '..', '.prisma', 'client', 'schema.prisma');
if (!fs.existsSync(generatedSchema)) fail('找不到生成的 schema.prisma：' + generatedSchema);
const schemaTxt = fs.readFileSync(generatedSchema, 'utf8');
const models = [...schemaTxt.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]);
console.log('SELFCHK_MODELS=' + models.join(','));

const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

(async () => {
  const t = await p.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table'");
  const tables = new Set(t.map((r) => String(r.name)));
  const missing = models.filter((m) => !tables.has(m));
  if (missing.length) fail('库里缺表（数据库尚未迁移到位）：' + missing.join(','));

  const ledger = await p.$queryRawUnsafe(
    'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name',
  );
  const applied = ledger.map((r) => String(r.migration_name));
  console.log('SELFCHK_APPLIED=' + applied.join(','));
  const missingMig = expected.filter((m) => !applied.includes(m));
  if (missingMig.length) fail('迁移账本缺条目：' + missingMig.join(','));

  // 逐表试读一次：把「列级不匹配」（如新增的 version 列）也提前暴露出来
  for (const model of models) {
    const args = model === 'project' ? { select: { id: true, version: true }, take: 1 } : { take: 1 };
    const delegate = p[model];
    if (!delegate || typeof delegate.findMany !== 'function') {
      fail('客户端没有模型委托 ' + model + '（预生成客户端未刷新）');
    }
    await delegate.findMany(args);
  }
  console.log('SELFCHK_READABLE_MODELS=' + models.length);
  console.log('SELFCHK_OK');
})()
  .catch((e) => fail(String(e && e.message ? e.message.split('\n')[0] : e)))
  .finally(() => p.$disconnect());
