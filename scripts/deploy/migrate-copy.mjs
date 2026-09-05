/**
 * 对「本地库副本」执行迁移，并处理本项目真实存在过的漂移情形（数据隔离专项·部署固化）。
 *
 * 背景：服务器的 node_modules 是 pnpm 自包含产物、没有 prisma CLI，所以迁移只能在本地
 * 对「拉回来的副本」做（由 server.mjs 调用）。而本项目的线上库里，0002 的对象
 * （User.status / deletedAt、RefreshToken 表）**当年是手工建的、没写进 `_prisma_migrations`**：
 * 直接 `migrate deploy` 会去重跑 0002 并撞 `duplicate column name: status` 而中断。
 * 这里的策略是「有界自愈」：只有当失败原因确属『对象已存在』时才把对应迁移补记账后重试，
 * 其余错误一律如实退出 —— 补记账等于对全库声明「这条迁移不必跑」，不能靠猜。
 *
 * 用法（可独立演练，无需碰服务器）：
 *   node scripts/deploy/migrate-copy.mjs d:\\path\\copy.db [--no-auto-resolve]
 * 输出：一行 JSON（before / pending / autoResolved / after / ok / error），退出码 0 或 1。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
// prisma CLI 与 migrations 都在 api 包内；read-db-state.mjs 也要以该包为 cwd 才解析得到 @prisma/client
const apiPkg = join(root, 'packages', 'api');
const migrationsDir = join(apiPkg, 'prisma', 'migrations');

const argv = process.argv.slice(2);
const dbArg = argv.find((a) => !a.startsWith('--'));
const noAutoResolve = argv.includes('--no-auto-resolve');

const result = {
  ok: false,
  db: dbArg ?? '',
  integrity: 'unknown',
  localMigrations: [],
  before: [],
  failed: [],
  pending: [],
  autoResolved: [],
  after: [],
  error: null,
};

function finish(code) {
  console.log(JSON.stringify(result));
  process.exit(code);
}

if (!dbArg) {
  result.error = '用法：migrate-copy.mjs <库文件绝对路径> [--no-auto-resolve]';
  finish(2);
}
const dbFile = resolve(dbArg);
if (!existsSync(dbFile)) {
  result.error = '库文件不存在：' + dbFile;
  finish(2);
}

const env = { ...process.env, DATABASE_URL: 'file:' + dbFile.replace(/\\/g, '/') };

function sh(cmd, args, label) {
  const r = spawnSync(cmd, args, { cwd: apiPkg, env, encoding: 'utf8', shell: true });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { status: r.status ?? 1, out, label };
}

/** 读账本：区分「已应用」与「失败未收尾」（后者不能当已应用，否则留下残缺 schema） */
function readState(step) {
  const r = sh('node', ['scripts/read-db-state.mjs'], 'read-db-state:' + step);
  const line = r.out.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).pop();
  if (!line) {
    result.error = `读取库状态失败（${step}）：` + r.out.split('\n').slice(-4).join(' / ');
    finish(1);
  }
  return JSON.parse(line);
}

result.localMigrations = readdirSync(migrationsDir)
  .filter((n) => existsSync(join(migrationsDir, n, 'migration.sql')))
  .sort();

const first = readState('before');
result.integrity = first.integrity;
result.before = first.applied.map((a) => a.name);
result.failed = first.failed ?? [];
if (first.integrity !== 'ok') {
  result.error = 'integrity_check 未通过：' + first.integrity;
  finish(1);
}
if (result.failed.length) {
  result.error =
    '库里有失败未收尾的迁移：' + result.failed.join(', ') + '，需人工 resolve（--rolled-back / --applied）后再部署';
  finish(1);
}

const applied = new Set(result.before);
result.pending = result.localMigrations.filter((m) => !applied.has(m));
if (result.pending.length === 0) {
  result.ok = true;
  result.after = result.before;
  finish(0);
}

// 有界自愈：每轮要么成功、要么补记账一条「对象已存在」的冲突迁移，轮数上限 = 本地迁移数
let done = false;
for (let i = 0; i <= result.localMigrations.length && !done; i++) {
  const dep = sh('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], 'migrate deploy');
  if (dep.status === 0) {
    done = true;
    break;
  }
  const name =
    /Applying migration `([^`]+)`/.exec(dep.out)?.[1] ??
    /Migration name:\s*([A-Za-z0-9_]+)/.exec(dep.out)?.[1] ??
    '';
  const existsErr = /duplicate column name|already exists|already in use/i.test(dep.out);
  if (noAutoResolve) {
    result.error = 'migrate deploy 失败（--no-auto-resolve：不做补记账）：' + dep.out.split('\n').slice(-6).join(' / ');
    finish(1);
  }
  if (!name || !existsErr) {
    result.error =
      'migrate deploy 失败，且不属于可安全补记账的「对象已存在」冲突：' +
      dep.out.split('\n').slice(-6).join(' / ');
    finish(1);
  }
  const res = sh('pnpm', ['exec', 'prisma', 'migrate', 'resolve', '--applied', name], 'migrate resolve');
  if (res.status !== 0) {
    result.error = `补记账 ${name} 失败：` + res.out.split('\n').slice(-4).join(' / ');
    finish(1);
  }
  result.autoResolved.push(name);
}
if (!done) {
  result.error = '多轮 migrate deploy 仍未完成，中止（副本未被回传，线上库不受影响）';
  finish(1);
}

const check = readState('after');
result.after = check.applied.map((a) => a.name);
const missing = result.localMigrations.filter((m) => !result.after.includes(m));
if (check.integrity !== 'ok' || missing.length) {
  result.error =
    '迁移后复核不通过：integrity=' + check.integrity + (missing.length ? '，仍缺 ' + missing.join(',') : '');
  finish(1);
}
result.ok = true;
finish(0);
