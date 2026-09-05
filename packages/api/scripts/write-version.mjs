// 构建后写入 dist/version.json（版本标记，部署一致性检查用，见开发计划 X6）
//
// gitSha 为什么带 `-dirty` 后缀：工作区有未提交改动时，产物其实来自那些改动；
// 只写 HEAD 会把「未提交的代码」伪装成「干净的 HEAD 产物」，部署核对就失去意义了
// （scripts/deploy/server.mjs 的版本校准与远端核对依赖这里的口径）。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));

/** git 输出（失败返回空串而不抛：无 git 的环境下仍要能出产物，标记退化为 unknown） */
const git = (args) => spawnSync('git', args, { encoding: 'utf8' }).stdout?.trim() ?? '';

const head = git(['rev-parse', '--short', 'HEAD']);
const dirty = head !== '' && git(['status', '--porcelain']) !== '';
const sha = head === '' ? 'unknown' : `${head}${dirty ? '-dirty' : ''}`;

writeFileSync(
  join(here, '..', 'dist', 'version.json'),
  `${JSON.stringify(
    { version: pkg.version, gitSha: sha, builtAt: new Date().toISOString() },
    null,
    2,
  )}\n`,
);
console.log(`[api] version.json written (v${pkg.version} ${sha})`);

