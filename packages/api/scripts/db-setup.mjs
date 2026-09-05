/**
 * db:setup（M0）：确保 data 目录 → 加载根 .env → prisma migrate deploy → 种子超管。
 * 单进程内串联，保证 DATABASE_URL 对 Prisma CLI 可见（Prisma CLI 不读仓库根 .env）。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// here = packages/api/scripts → 3 级 .. 到仓库根
const root = join(here, '..', '..', '..');
const apiDir = join(root, 'packages', 'api');

// 1) SQLite 数据目录（gitignore 的 ./data/）
mkdirSync(join(root, 'data'), { recursive: true });

// 2) 根 .env：不存在则从 .env.example 生成
const rootEnv = join(root, '.env');
if (!existsSync(rootEnv)) {
  const example = join(root, '.env.example');
  if (existsSync(example)) {
    copyFileSync(example, rootEnv);
    console.log('[db] 已从 .env.example 生成 .env');
  }
}

// 3) 注入环境变量（Prisma CLI 与 seed 进程共用）
if (existsSync(rootEnv)) {
  for (const line of readFileSync(rootEnv, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

// 4) 生成客户端 → 迁移 → 种子
const run = (cmd) => {
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true, env: process.env, cwd: apiDir });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
console.log('[db] prisma generate ...');
run('pnpm exec prisma generate');
console.log('[db] prisma migrate deploy ...');
run('pnpm exec prisma migrate deploy');
console.log('[db] seed ...');
run('pnpm exec tsx prisma/seed.ts');
console.log('[db] setup done');
