/**
 * 读取「目标 SQLite 库」的迁移账本与健康度（数据隔离专项·部署固化）。
 *
 * 为什么需要它：部署机（服务器）上没有 prisma CLI，迁移必须在本地对「拉回来的库副本」执行；
 * 而执行前要先判断「本地有、账本里没有」的待应用迁移，才能决定这次部署到底要不要停机走 DB 流程。
 * Prisma 的 `migrate status` 只读不给机器可读输出，故直接用客户端读 `_prisma_migrations`。
 *
 * 用法（cwd 必须是 packages/api，那里才解析得到 @prisma/client）：
 *   DATABASE_URL=file:d:/path/copy.db node scripts/read-db-state.mjs
 * 输出：一行 JSON（integrity / tables / applied / checksums），供 server.mjs 解析。
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('read-db-state: 需要 DATABASE_URL（指向要检查的库文件）');
  process.exit(2);
}

const p = new PrismaClient({ datasources: { db: { url } } });

const out = { ok: false, integrity: 'unknown', tables: [], applied: [], failed: [], error: null };

try {
  const ig = await p.$queryRawUnsafe('PRAGMA integrity_check');
  out.integrity = Array.isArray(ig) && ig.length ? String(Object.values(ig[0])[0]) : 'empty';

  const t = await p.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  out.tables = t.map((r) => r.name);

  // 全新库（连表都没有）：Prisma 会自己建账本，这里按「已应用 = 空」处理
  if (out.tables.includes('_prisma_migrations')) {
    const rows = await p.$queryRawUnsafe(
      'SELECT migration_name, checksum, finished_at FROM _prisma_migrations ORDER BY migration_name',
    );
    // 「失败未收尾」的判定必须扣除同名的成功行：
    // deploy 撞 duplicate column 时 Prisma 会留下一行 finished_at=NULL 的记录，
    // 随后 `migrate resolve --applied` 是**新增**一行成功记录、并不删除那行孤儿。
    // 若见 NULL 就判失败，脚本自己补记账过的库会把此后每次部署都卡住（本次实测踩到）。
    const appliedNames = new Set(
      rows.filter((r) => r.finished_at !== null).map((r) => String(r.migration_name)),
    );
    for (const r of rows) {
      const name = String(r.migration_name);
      if (r.finished_at === null) {
        if (!appliedNames.has(name) && !out.failed.includes(name)) out.failed.push(name);
      } else if (!out.applied.some((a) => a.name === name)) {
        out.applied.push({ name, checksum: String(r.checksum ?? '') });
      }
    }
  }
  out.ok = out.integrity === 'ok' && out.failed.length === 0;
} catch (err) {
  out.error = String(err && err.message ? err.message.split('\n')[0] : err);
} finally {
  await p.$disconnect();
}

console.log(JSON.stringify(out));
process.exit(out.ok ? 0 : 1);
