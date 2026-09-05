/**
 * 一键部署到自托管服务器（详见 README「部署」小节）
 *
 * 流程（含数据库迁移与 Prisma 客户端同步 —— 数据隔离专项·部署固化）：
 *   构建 + **版本标记校准**（防 turbo 缓存复用旧 sha）→ JWT/密钥前置检查 → 停服 → 备份并拉库
 *   → 本地 prisma migrate deploy（自动识别「对象已存在但未记账」的漂移）→ 回传库 → 刷新
 *   服务端预生成 Prisma Client → 上传 dist / web（先传 .new 再改名，失败不毁旧站）
 *   → 启动前一致性自检 → 起服 → **版本核对（基准 = 当前提交）** + 外部探活。
 *
 * 用法：
 *   pnpm deploy:server                  # 完整部署（自动判断有无待应用迁移）
 *   pnpm deploy:server -- --dry-run     # 只打印将执行的命令，不真正执行
 *   pnpm deploy:server -- --skip-build  # 跳过本地构建（复用已有 dist）
 *   pnpm deploy:server -- --no-restart  # 上传后不重启 svc-node（首次初始化用）
 *   pnpm deploy:server -- --no-db       # 跳过停服 / 迁移 / 客户端同步（纯前端热修时用）
 *   pnpm deploy:server -- --no-auto-resolve  # 迁移撞「已存在」时直接中止而非补记账
 *
 * 环境变量覆盖（DEPLOY_HOST 必填，其余可选；目录类默认值为作者内网环境的示例路径）：
 *   DEPLOY_HOST     必填，目标服务器地址（如 Tailscale IP）；不设则启动时报错
 *   DEPLOY_USER     默认 dev（SSH 用户名）
 *   DEPLOY_API_DIR  默认 D:/Server/archview/api（Node 后端目录，需已有 node_modules）
 *   DEPLOY_WEB_DIR  默认 D:/Server/www/archview（IIS 默认站点根，内容即 dist 本体）
 *   DEPLOY_ENV_FILE 默认 D:/Server/.env（服务端环境变量文件）
 *
 * 为什么迁移必须在本地对「拉回来的库副本」执行：服务器是 `pnpm deploy --prod` 的自包含
 * 产物，没有 prisma CLI（只有 @prisma/client 运行时）；且服务端 node_modules 里的客户端
 * 是首次打包时生成的，只换 dist 不会带上新模型（如 prisma.auditLog 会是 undefined）。
 * 两处都得由本脚本补上，否则「改了 schema 再部署」必然在运行期才炸（本次实测踩过）。
 *
 * 服务器首次初始化（供参考：自托管环境的初始化步骤示例）：
 *   1) api 自包含包（pnpm deploy --prod + 生成的 .prisma/client + 全部 junction 相对化）
 *      解包到 D:\Server\archview\api，junction 由生成的 server-junctions.cmd 重建；
 *   2) D:\Server\.env：DATABASE_URL=file:D:/Server/archview/api/data/archview.db、
 *      JWT_SECRET（≥32 字符随机串）、NODE_ENV=production、PORT=3007、
 *      CORS_ORIGIN=http://<服务器IP>、WEB_ROOT=D:/Server/www/archview
 *      （API 同端口托管 web 构建；ConfigModule 读 dist 上三级）；
 *   3) svc-node 服务：使用 nssm 安装，
 *      AppPath=node.exe、AppParameters=dist\main.js、AppDirectory=api 目录、自动启动；
 *   4) IIS：appcmd set vdir "Default Web Site/" /physicalPath:D:\Server\www\archview，
 *      站点需 Started（注意：与其他无 host 的 *:80: 站点互斥）；
 *   5) 端口：ArchView API 使用 3007（避开同机已占用的端口）。
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// here = scripts/deploy → 仓库根；api 包根（prisma CLI / migrations 都在这下面）
const root = join(here, '..', '..');
const apiPkg = join(root, 'packages', 'api');
const migrationsDir = join(apiPkg, 'prisma', 'migrations');
const tmpDir = join(root, '.tmp');

// ---------- 参数与环境 ----------
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipBuild = args.includes('--skip-build');
const noRestart = args.includes('--no-restart');
const noDb = args.includes('--no-db');
const noAutoResolve = args.includes('--no-auto-resolve');

if (!process.env.DEPLOY_HOST) {
  console.error('[deploy] 缺少必填环境变量 DEPLOY_HOST（目标服务器地址，如 Tailscale IP；开源后不再把作者内网地址写死进默认值）');
  process.exit(1);
}
const HOST = process.env.DEPLOY_HOST;
const USER = process.env.DEPLOY_USER ?? 'dev';
const TARGET = `${USER}@${HOST}`;
const API_DIR = (process.env.DEPLOY_API_DIR ?? 'D:/Server/archview/api').replace(/\\/g, '/');
const WEB_DIR = (process.env.DEPLOY_WEB_DIR ?? 'D:/Server/www/archview').replace(/\\/g, '/');
const BASE_DIR = dirname(API_DIR); // 远程工作区根（放批处理文件）
const WEB_PARENT = dirname(WEB_DIR);
const ENV_FILE = (process.env.DEPLOY_ENV_FILE ?? 'D:/Server/.env').replace(/\//g, '\\');
const remoteDataDir = () => `${API_DIR}/data`;
const remoteDb = () => `${remoteDataDir()}/archview.db`;

/** 远端 cmd 用反斜杠；scp 目标用正斜杠（`user@host:D:\...` 的盘符冒号会被解析成主机名） */
const bs = (p) => p.replace(/\//g, '\\');
const remoteScp = (p) => `${TARGET}:${p.replace(/\\/g, '/')}`;

// Windows 自带 OpenSSH（ssh/scp）可能不在 PATH：补上系统目录（X6）
const OPENSSH_DIR = 'C:\\Windows\\System32\\OpenSSH';
if (existsSync(OPENSSH_DIR) && !process.env.PATH.toLowerCase().includes('openssh')) {
  process.env.PATH = `${OPENSSH_DIR};${process.env.PATH}`;
}

const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
const TS = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
  d.getMinutes(),
)}${pad(d.getSeconds())}`;

// ---------- 执行器 ----------
/**
 * ssh / scp 必须绕开 shell：spawnSync(..., {shell:true}) 会把整条命令交给本地 cmd 拼接，
 * 远端命令里的 `&&`（如 `cd /d D:\...\api && node selfcheck.cjs`）会被本地 cmd 截断，
 * 导致后半段在本机执行 —— 本次就因此报了 "Cannot find module 'D:\<项目目录>\server-apply-client.cjs'"。
 * pnpm / git 是 .cmd，仍需 shell；ssh.exe / scp.exe 是真 exe，直传参数即可。
 */
const needsShell = (cmd) => !/^(ssh|scp)$/i.test(String(cmd));

function run(cmd, cmdArgs, desc, opts = {}) {
  console.log(`\n▶ ${desc}`);
  console.log(`  $ ${cmd} ${cmdArgs.join(' ')}`);
  if (dryRun) return { status: 0, stdout: '' };
  const r = spawnSync(cmd, cmdArgs, {
    stdio: 'inherit',
    cwd: opts.cwd ?? root,
    shell: needsShell(cmd),
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  });
  if (r.status !== 0) die(`${desc} 失败（exit ${r.status}）`);
  return { status: r.status ?? 0, stdout: '' };
}

/** 需要读回显时用（迁移账本、deploy 结果解析）：失败不直接退出，交调用方判读 */
function cap(cmd, cmdArgs, desc, opts = {}) {
  console.log(`\n▶ ${desc}`);
  console.log(`  $ ${cmd} ${cmdArgs.join(' ')}`);
  if (dryRun) return { status: 0, stdout: '', skipped: true };
  const r = spawnSync(cmd, cmdArgs, {
    encoding: 'utf8',
    cwd: opts.cwd ?? root,
    shell: needsShell(cmd),
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) console.log(out.trim().split('\n').slice(-14).join('\n'));
  return { status: r.status ?? 1, stdout: out, skipped: false };
}

/** 中止部署：把本次留下的备份位置与恢复命令摊出来，别让主人在机器上翻 */
function die(msg) {
  console.error(`\n✖ ${msg}`);
  console.error('──────── 回滚线索 ────────');
  console.error(`  · 库备份：${remoteDataDir()}/ 下的 archview-${TS}.bak 与更早的 .bak`);
  console.error(`  · .env 备份：${ENV_FILE}.pre-rotate-*.bak（若本次轮换过密钥）`);
  console.error('  · 客户端备份：api/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/*.pre-*.bak');
  console.error('  · 若失败点在换入之前 → 线上处于停机态（先回滚再 net start svc-node）；若在换入之后 → 先查服务状态（sc query svc-node）与探活结果再定');
  console.error(`  · 恢复库：ssh ${TARGET} "copy /Y ${bs(remoteDb())} 的某个 .bak → ${bs(remoteDb())}"`);
  process.exit(1);
}

function remoteBatch(name, lines, desc) {
  // 生成 .cmd 批处理并上传到远程工作区：无论远端默认 shell 是 cmd 还是 PowerShell 都能执行
  const file = join(root, '.tmp', name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, lines.join('\r\n') + '\r\n', 'utf8');
  console.log(`\n▶ ${desc}（${file}）`);
  for (const line of lines) console.log(`    ${line}`);
  if (!dryRun) {
    // scp 走无 shell 直传（见 needsShell 注释）：路径含 & 之类字符时不会被本地解释
    const up = spawnSync('scp', [file, `${USER}@${HOST}:${BASE_DIR}\\${name}`], {
      stdio: 'inherit',
      cwd: root,
      shell: false,
    });
    if (up.status !== 0) {
      console.error(`✖ 上传 ${name} 失败`);
      process.exit(1);
    }
  }
}

function remoteCmd(command, desc) {
  // 在远端执行一条命令（.cmd 直接作为命令，cmd / PowerShell 均可运行）；
  // -n：stdin 重定向为 NUL，防远端 shell（PowerShell）读本地 stdin 挂起（X6）
  run('ssh', ['-n', `${USER}@${HOST}`, command], desc);
}

/** 本地生成的 Prisma Client 产物目录（pnpm 严格布局下在 .pnpm 里，随版本号变化，故扫描而非写死） */
function findLocalClientDir() {
  for (const base of [join(root, 'node_modules', '.pnpm'), join(apiPkg, 'node_modules', '.pnpm')]) {
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      if (!name.startsWith('@prisma+client@')) continue;
      const dir = join(base, name, 'node_modules', '.prisma', 'client');
      if (existsSync(join(dir, 'index.js'))) return dir;
    }
  }
  die('找不到本地生成的 Prisma Client 产物（先跑 pnpm db:setup 或 prisma generate）');
  return '';
}

/** 本地 dist 的版本标记（校准步写入、远端核对与本地断言都读它） */
function localGitSha() {
  const file = join(apiPkg, 'dist', 'version.json');
  if (!existsSync(file)) return '';
  try {
    return String(JSON.parse(readFileSync(file, 'utf8')).gitSha ?? '');
  } catch {
    return '';
  }
}

/**
 * **当前提交**的短 sha —— 版本核对唯一可信的事实源。
 *
 * 为什么不能拿 `localGitSha()` 当基准：那份文件是刚 scp 上去的，「远端 == 本地」两边同源、
 * 必然相等，只能证明「上传成功」，证明不了「产物是当次提交的」—— 是一处假绿。
 * 实测过连续多次部署的远端 gitSha 一直停在 `5ea532e` / `3d33250`，与当次提交无关：
 * turbo 缓存命中时 `api:build` 整步被跳过，`write-version.mjs` 跟着不跑。
 * 故部署流程改为「构建后无条件校准标记 + 核对以当前提交为基准」（见第 1 步末尾）。
 */
function headShortSha() {
  return (spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout ?? '').trim();
}

/** 本地 prisma/migrations 下的迁移名（有 migration.sql 才算） */
function localMigrations() {
  return readdirSync(migrationsDir)
    .filter((n) => existsSync(join(migrationsDir, n, 'migration.sql')))
    .sort();
}

console.log('══════════════════════════════════════════════');
console.log(' ArchView 部署（自托管服务器）');
console.log(` 主机      ${TARGET}`);
console.log(` API 目录  ${API_DIR}`);
console.log(` Web 目录  ${WEB_DIR}`);
console.log(` 库文件    ${remoteDb()}`);
if (noDb) console.log(' 跳过      数据库迁移与客户端同步（--no-db）');
if (dryRun) console.log(' 模式      DRY-RUN（只打印，不执行）');
console.log('══════════════════════════════════════════════');

// ---------- 1) 本地构建 + 生成客户端 ----------
// prisma generate 必须跑：要上传到服务端的「预生成客户端」就得和 committed schema 同源，
// 否则服务端拿到新 dist 却没有新模型委托（prisma.auditLog === undefined）。
if (!skipBuild) {
  run('pnpm', ['build'], '构建所有包（turbo build）');
}
if (!noDb) {
  // 生成 Prisma Client（与 schema 对齐）：要上传到服务端的预生成客户端必须与代码同源
  run('pnpm', ['exec', 'prisma', 'generate'], '生成 Prisma Client（与 schema 对齐）', { cwd: apiPkg });
}
if (!dryRun) {
  const webDist = join(root, 'apps', 'web', 'dist');
  const apiDist = join(apiPkg, 'dist');
  if (!existsSync(join(webDist, 'index.html'))) die('未找到 apps/web/dist/index.html，请先 pnpm build');
  if (!existsSync(join(apiDist, 'main.js'))) die('未找到 packages/api/dist/main.js，请先 pnpm build');
}

// 版本标记校准：`pnpm build` 走 turbo，api 输入未变时整步 `api:build` 被缓存命中跳过，
// `write-version.mjs` 跟着不跑 ⇒ dist/version.json 停在旧提交，而这枚标记既是上线证据、
// 又是远端核对的基准（历史上连续几次部署的远端 gitSha 都停在旧值就是这个原因）。
// 这里无条件重写一次。为什么可以诚实：turbo 的缓存 key 覆盖 api 的全部输入，
// 输入未变 ⇒ 产物内容与当前提交等价；工作区有未提交改动时写入 `<sha>-dirty`，脏改动照样看得见。
run(
  'node',
  [join(apiPkg, 'scripts', 'write-version.mjs')],
  '校准版本标记 dist/version.json（防 turbo 缓存复用旧 sha）',
);
if (!dryRun) {
  const head = headShortSha();
  const marked = localGitSha();
  if (!head) die('本地 git 不可用（读不到 HEAD 短 sha）：宁可中止，也不留无基准的部署');
  if (!marked || marked === 'unknown') die('版本标记校准失败：dist/version.json 未写入 gitSha');
  if (!marked.startsWith(head)) {
    die(`版本标记 ${marked} 与当前提交 ${head} 不符：write-version.mjs 未生效？`);
  }
  console.log(`  标记已对齐当前提交：${marked}${marked.endsWith('-dirty') ? '（工作区有未提交改动）' : ''}`);
}

// ---------- 2) 远端目录 + JWT 密钥前置检查（批次 D / S6）----------
// 命门：JWT_SECRET 缺失或仍是仓库占位值时，任何人都能自签 sub=任意用户 的令牌接管他人工程；
// 服务端启动会硬失败（packages/api/src/config/env.ts），但那时服务已经停了 —— 这里提前挡下。
remoteCmd(`if not exist ${BASE_DIR} mkdir ${BASE_DIR}`, '确保远端工作区目录');

const preflight = 'archview-preflight-jwt.cmd';
remoteBatch(
  preflight,
  [
    '@echo off',
    // 只检查存在性与是否仍是仓库占位值；绝不 echo 密钥内容
    `if not exist "${ENV_FILE}" goto :fail_missing`,
    `findstr /B /C:"JWT_SECRET=" "${ENV_FILE}" >nul || goto :fail_unset`,
    `findstr /C:"JWT_SECRET=dev-jwt-secret" "${ENV_FILE}" >nul && goto :fail_placeholder`,
    'rem NODE_ENV=production is what turns the server-side secret check into a hard failure',
    `findstr /B /C:"NODE_ENV=production" "${ENV_FILE}" >nul || goto :fail_no_nodeenv`,
    'echo [deploy] PREFLIGHT_OK',
    'exit /b 0',
    ':fail_missing',
    'echo [deploy] PREFLIGHT_FAIL=missing_env_file',
    'exit /b 41',
    ':fail_unset',
    'echo [deploy] PREFLIGHT_FAIL=jwt_secret_unset',
    'exit /b 42',
    ':fail_placeholder',
    'echo [deploy] PREFLIGHT_FAIL=jwt_secret_is_repo_placeholder',
    'exit /b 43',
    ':fail_no_nodeenv',
    'echo [deploy] PREFLIGHT_FAIL=node_env_not_production',
    'exit /b 44',
  ],
  '生成并上传 JWT 前置检查脚本',
);
remoteCmd(`${BASE_DIR}\\${preflight}`, '校验远端 JWT_SECRET / NODE_ENV（不合格即中止部署）');



// ---------- 3) 数据库迁移（拉回本地 → migrate → 回传）+ 4) 刷新服务端客户端 ----------
// 服务器是 pnpm deploy --prod 的自包含产物：没有 prisma CLI（只有 client 运行时），
// 所以迁移必须在本地对「拉回来的副本」执行；而服务端 node_modules 里的客户端是首次
// 打包时生成的，只换 dist 不会带上新模型 —— 两处都得在这里补上（本次实测踩过）。
// 顺序关键：先停服再拉库。SQLite 写入过程中复制可能拿到撕裂页，且回传期间绝不能有人写入。
const expectedMigrations = localMigrations();
console.log(`\n▶ 本地迁移清单：${expectedMigrations.join(', ') || '(无)'}`);
let dbChanged = false;

if (noDb) {
  console.log('  ⚠ 已按 --no-db 跳过停服 / 迁移 / 客户端同步：本次若含 schema 变更，线上会运行期报错');
} else if (dryRun) {
  console.log(
    '\n▶ [DRY-RUN] 数据库阶段将执行：停服 → 备份 → scp 拉库 → prisma migrate deploy' +
      '（撞「对象已存在」时自动补记账后重试）→ 复核 → 回传 → 刷新服务端 Prisma Client',
  );
} else {
  // 停服要「容忍已停」但「必须确认真的停了」：
  // 容忍 —— net stop 对已停服务返回 2（上一轮中断就会留下这种状态），不能当失败；
  // 确认 —— 服务若还在跑就拉库/回传，副本可能是撕裂页，回传更会直接覆盖在线写入。
  const stopCmd = 'archview-stop-svc.cmd';
  remoteBatch(
    stopCmd,
    [
      '@echo off',
      `net stop svc-node >nul 2>&1`,
      'sc query svc-node | findstr /C:"STOPPED" >nul && goto :ok',
      'echo [deploy] STOP_FAIL=svc_node_not_stopped',
      'exit /b 61',
      ':ok',
      'echo [deploy] STOPPED_OK',
      'exit /b 0',
    ],
    '生成并上传停服脚本（幂等 + 状态确认）',
  );
  remoteCmd(`${BASE_DIR}\\${stopCmd}`, '停止 svc-node 并确认状态（保证副本一致、回传期间无写入）');

  const phase0 = 'archview-phase0-backup.cmd';
  remoteBatch(
    phase0,
    [
      '@echo off',
      `if not exist "${bs(API_DIR)}" mkdir "${bs(API_DIR)}"`,
      `if not exist "${bs(remoteDataDir())}" mkdir "${bs(remoteDataDir())}"`,
      `if not exist "${bs(WEB_PARENT)}" mkdir "${bs(WEB_PARENT)}"`,
      `if not exist "${bs(`${API_DIR}/prisma`)}" mkdir "${bs(`${API_DIR}/prisma`)}"`,
      `rem backup SQLite before deploy: rollback source if migrate or push-back goes wrong`,
      `if exist "${bs(remoteDb())}" copy /Y "${bs(remoteDb())}" "${bs(`${remoteDataDir()}/archview-${TS}.bak`)}" >nul`,
      `rem drop last run's client staging dir (scp -r into an existing dir nests it)`,
      `if exist "${bs(`${BASE_DIR}/client-stage`)}" rmdir /S /Q "${bs(`${BASE_DIR}/client-stage`)}"`,
      'echo [deploy] BACKUP_DONE',
    ],
    '生成并上传备份脚本（建目录 + 备份 SQLite）',
  );
  remoteCmd(`${BASE_DIR}\\${phase0}`, '远端备份数据库并建齐目录');

  mkdirSync(tmpDir, { recursive: true });
  const localOrig = join(tmpDir, `deploy-db-${TS}.orig.db`);
  const localWork = join(tmpDir, `deploy-db-${TS}.work.db`);
  run('scp', [remoteScp(remoteDb()), localOrig], '拉取服务端库副本（迁移在此副本上执行，绝不动线上文件）');
  copyFileSync(localOrig, localWork);

  // 迁移逻辑收在 migrate-copy.mjs：它可脱离部署单独跑（本轮三种状态都是用它实测出来的：
  // 正常应用 / 漂移补记账后二次部署幂等 / 真·未收尾迁移拒绝代劳），这里只做编排。
  const mc = cap(
    'node',
    [join(here, 'migrate-copy.mjs'), localWork, ...(noAutoResolve ? ['--no-auto-resolve'] : [])],
    '对副本执行迁移（含漂移识别与有界自愈）',
  );
  const mcLine = mc.stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).pop();
  if (!mcLine) die('migrate-copy 没有任何输出（子进程未正常结束），中止部署：线上库与产物均未回传');
  const mr = JSON.parse(mcLine);
  console.log(
    `  账本：${mr.before.join(', ') || '(空)'}` +
      (mr.pending.length ? ` → 待应用 ${mr.pending.join(', ')}` : ' → 无待应用迁移') +
      (mr.autoResolved.length ? `；其中 ${mr.autoResolved.join(', ')} 为历史手工应用，已补记账` : ''),
  );
  if (!mr.ok) die('副本迁移未通过：' + mr.error);
  if (mr.pending.length === 0) {
    console.log('  ✅ 无待应用迁移 → 不回传库（避免无谓写盘，线上库零风险）');
  } else {
    console.log('  ✅ 副本迁移完成并复核通过 → 回传替换线上库');
    dbChanged = true;
    run('scp', [localWork, remoteScp(remoteDb())], '回传已迁移的库');
  }

  // ---------- 4) 刷新服务端预生成 Prisma Client ----------
  const clientDir = findLocalClientDir();
  const localStage = join(tmpDir, 'client-stage');
  rmSync(localStage, { recursive: true, force: true });
  mkdirSync(localStage, { recursive: true });
  for (const f of readdirSync(clientDir)) {
    const full = join(clientDir, f);
    if (!statSync(full).isFile()) continue;
    if (/\.(node|dll|exe)$/i.test(f)) continue; // 引擎二进制不动：prisma 版本未变即无需替换
    copyFileSync(full, join(localStage, f));
  }
  console.log(`  暂存新生成客户端产物：${readdirSync(localStage).length} 个文件（来自 ${clientDir.replace(root + '\\', '')}）`);
  run(
    'scp',
    [join(here, 'server-apply-client.cjs'), join(here, 'server-selfcheck.cjs'), remoteScp(`${API_DIR}/`)],
    '上传服务端辅助脚本（客户端刷新 + 启动前自检）',
  );
  run('scp', ['-r', localStage, remoteScp(`${BASE_DIR}/client-stage`)], '上传新生成的 Prisma Client 产物');
  const ac = cap(
    'ssh',
    ['-n', TARGET, `cd /d ${bs(API_DIR)} && node server-apply-client.cjs ${bs(`${BASE_DIR}/client-stage`)} ${TS}`],
    '刷新服务端 Prisma Client（运行时反查真实路径 + 旧文件备份）',
  );
  if (!/APPLYCLIENT_OK/.test(ac.stdout)) die('服务端 Prisma Client 刷新未通过（见上方输出）');


}

// ---------- 5) 上传产物（先传 .new 再改名：任一步失败都不会毁掉正在服务的旧产物）----------
// 旧流程是「先 rmdir dist 再 scp」，中途失败就留下一个没有 dist 的机器；改成旁路上传 + 起服前换名。
// 先清上一次的 .new 残留：否则 scp -r 会套娃成 dist.new/dist（目录已存在时 scp 会拷进去）。
remoteCmd(
  `if exist "${bs(`${API_DIR}/dist.new`)}" rmdir /S /Q "${bs(`${API_DIR}/dist.new`)}" & if exist "${bs(`${WEB_PARENT}/archview.new`)}" rmdir /S /Q "${bs(`${WEB_PARENT}/archview.new`)}"`,
  '清理上次可能残留的 .new 暂存目录（否则 scp -r 会套娃成 dist.new/dist）',
);
run('scp', ['-r', join(apiPkg, 'dist'), remoteScp(`${API_DIR}/dist.new`)], '上传 api dist 到 dist.new（旁路暂存）');
run(
  'scp',
  ['-r', join(root, 'apps', 'web', 'dist'), remoteScp(`${WEB_PARENT}/${basename(WEB_DIR)}.new`)],
  '上传 web dist 到 <站点名>.new（旁路暂存）',
);
if (!noDb) {
  // 顺手刷新服务端的 prisma/ 参考副本：它会误导人（本次排障时它停留在 0001，
  // 让人误判「服务端从未应用过 0002」）。运行期不读它，失败只告警不中止。
  const pr = cap('scp', [join(apiPkg, 'prisma', 'schema.prisma'), remoteScp(`${API_DIR}/prisma/schema.prisma`)], '刷新服务端 prisma/schema.prisma（参考副本）');
  if (pr.status !== 0) console.log('  （schema.prisma 刷新失败，不影响运行，仅参考副本过期）');
  const mr = cap('scp', ['-r', join(apiPkg, 'prisma', 'migrations'), remoteScp(`${API_DIR}/prisma/migrations`)], '刷新服务端 prisma/migrations（参考副本）');
  if (mr.status !== 0) console.log('  （migrations 刷新失败，不影响运行，仅参考副本过期）');
}

// ---------- 6) 启动前一致性自检：新客户端 ↔ 已迁移库 ----------
// 这一步是整套流程的保险丝：任一落后（客户端新库旧 / 库新客户端旧）都拒绝起服，
// 而不是让 svc-node 起来后在日志里炸。
if (!noDb && !dryRun) {
  const sc = cap(
    'ssh',
    ['-n', TARGET, `cd /d ${bs(API_DIR)} && node server-selfcheck.cjs "${ENV_FILE}" ${expectedMigrations.join(' ')}`.trim()],
    '启动前自检（客户端模型 ↔ 库表 ↔ 迁移账本 三方对齐）',
  );
  if (!/SELFCHK_OK/.test(sc.stdout)) die('启动前自检未通过，拒绝起服（见上方 SELFCHK_* 输出）');
  console.log('  ✅ 自检通过：模型、表与迁移账本一致');
}

// ---------- 7) 停服换入新产物 → 起服 ----------
const swap = 'archview-swap-restart.cmd';
const API_LEAF = 'dist';
const WEB_LEAF = basename(WEB_DIR);
const WEB_NEW = `${WEB_PARENT}/${WEB_LEAF}.new`;
// 生成的 .cmd 一律只写 ASCII：cmd.exe 按机器码页（中文环境是 GBK）读批处理文件，
// UTF-8 中文字节会打乱行解析（本次就因此把 `if not exist` 读断了）。旁白留在 Node 侧。
// 结构上用 goto 标签 + ver >nul 清 ERRORLEVEL，避免「上一个分支没跑」被误判成失败。
remoteBatch(
  swap,
  [
    '@echo off',
    'net stop svc-node >nul 2>&1',
    `if not exist "${bs(`${API_DIR}/${API_LEAF}.new`)}" goto :fail_new_api`,
    `if not exist "${bs(WEB_NEW)}" goto :fail_new_web`,
    `if exist "${bs(`${API_DIR}/${API_LEAF}.old.rolling`)}" rmdir /S /Q "${bs(`${API_DIR}/${API_LEAF}.old.rolling`)}"`,
    `if exist "${bs(`${WEB_DIR}.old.rolling`)}" rmdir /S /Q "${bs(`${WEB_DIR}.old.rolling`)}"`,
    'ver >nul',
    `if exist "${bs(`${API_DIR}/${API_LEAF}`)}" ren "${bs(`${API_DIR}/${API_LEAF}`)}" "${API_LEAF}.old.rolling"`,
    'if errorlevel 1 goto :fail_busy',
    `ren "${bs(`${API_DIR}/${API_LEAF}.new`)}" "${API_LEAF}"`,
    'if errorlevel 1 goto :fail_swap',
    'ver >nul',
    `if exist "${bs(WEB_DIR)}" ren "${bs(WEB_DIR)}" "${WEB_LEAF}.old.rolling"`,
    'if errorlevel 1 goto :fail_busy',
    `ren "${bs(WEB_NEW)}" "${WEB_LEAF}"`,
    'if errorlevel 1 goto :fail_swap',
    noRestart ? 'echo [deploy] SKIP_RESTART=1' : 'net start svc-node',
    'rem IIS default site: start if stopped; failure is non-fatal (web also served by the API port)',
    '%SystemRoot%\\system32\\inetsrv\\appcmd start site "Default Web Site" 2>nul',
    'echo [deploy] SWAP_DONE',
    'exit /b 0',
    ':fail_new_api',
    'echo [deploy] SWAP_FAIL=missing_api_dist_new',
    'exit /b 51',
    ':fail_new_web',
    'echo [deploy] SWAP_FAIL=missing_web_new',
    'exit /b 52',
    ':fail_busy',
    'echo [deploy] SWAP_FAIL=rename_blocked_in_use',
    'exit /b 53',
    ':fail_swap',
    'echo [deploy] SWAP_FAIL=rename_in_failed_restore_old_rolling',
    'exit /b 54',
  ],
  '生成并上传换名换入 + 重启脚本',
);
const swapRes = cap('ssh', ['-n', TARGET, `${BASE_DIR}\\${swap}`], '执行换入新产物与起服（svc-node + IIS 站点）');
if (swapRes.skipped) {
  /* dry-run：remoteBatch 只打印，cap 已跳过 */
} else if (!/SWAP_DONE/.test(swapRes.stdout)) {
  die('换入新产物 / 起服失败（见上方 [deploy] 标记）。线上可能处于停机态，请按回滚线索处理');
}

// ---------- 8) 版本一致性与外部探活（X6）----------
if (!dryRun) {
  const v = cap('ssh', ['-n', TARGET, `type ${bs(`${API_DIR}/dist/version.json`)}`], '校验远端版本标记 dist/version.json');
  console.log(v.stdout.trim() ? `  远端版本: ${v.stdout.trim().replace(/\s+/g, ' ')}` : '  （未读到 version.json）');
  // 基准是**当前提交**，不是本地 version.json —— 后者就是刚传上去的那份，两边同源必等，
  // 那套旧比对只能证明「scp 成功」（假绿）。现在要求远端标记 == 当次部署的提交，
  // 才真正挡得住「传了旧 dist / 忘了重新构建」。允许 `-dirty` 后缀（工作区不干净时写入）。
  const head = headShortSha();
  const got = /"gitSha":\s*"([^"]+)"/.exec(v.stdout)?.[1] ?? '';
  if (!got) die('远端读不到 dist/version.json 的 gitSha：版本核对无法完成');
  if (!head) die('本地 git 不可用，无法确定当前提交：版本核对无法完成');
  if (!got.startsWith(head)) {
    die(`远端 gitSha ${got} ≠ 当前提交 ${head}：说明传了旧 dist 或忘了重新构建`);
  }
  console.log(`  ✓ 远端产物即当前提交（${got}）`);

  console.log('\n▶ 外部探活：未带令牌访问 /api/v1/projects 应回 401（新守卫链路的冒烟检查）');
  // `net start` 返回只说明服务「已启动」：Node + Prisma 冷启动（引擎初始化 + 监听）还要
  // 几秒，单次 10s 探活在慢机器上会误报失败。实测：产物已换入、版本核对通过，
  // 探活却超时，人工复探 401 正常。改轮询等待：至多 5 轮（单轮请求超时 10s、轮间隔 3s，
  // 总时长约 62s），全跑完仍拿不到 401 才判失败。
  let probeFail = '';
  let probeOk = false;
  for (let attempt = 1; attempt <= 5 && !probeOk; attempt++) {
    try {
      const res = await fetch(`http://${HOST}:3007/api/v1/projects`, { signal: AbortSignal.timeout(10000) });
      const body = await res.text();
      if (res.status === 401) {
        console.log(`  HTTP ${res.status} ${body.slice(0, 120)}`);
        probeOk = true;
      } else {
        probeFail = `期望 401，实得 ${res.status}（请检查 svc-node 与 CORS/反代）`;
        console.log(`  探活第 ${attempt} 轮：${probeFail}（服务可能仍在冷启动）`);
      }
    } catch (err) {
      probeFail = err.message;
      console.log(`  探活第 ${attempt} 轮失败：${err.message}（服务可能仍在冷启动）`);
    }
    if (!probeOk && attempt < 5) await new Promise((r) => setTimeout(r, 3000));
  }
  if (!probeOk) die(`探活异常：${probeFail}`);
  if (dbChanged) console.log('  ℹ 本次已替换过服务端库文件（迁移应用成功）');
}

console.log('\n✅ 部署完成，验证入口：');
console.log(`   http://${HOST}:3007      （标准入口：前端 + API 同端口）`);
console.log(`   http://${HOST}        （IIS，同内容）`);
if (!dryRun) {
  console.log(`   本次备份：${remoteDataDir()}/archview-${TS}.bak`);
  if (!noDb) console.log(`   旧产物保留：${API_DIR}/dist.old.rolling（下次部署自动清理）`);
}
