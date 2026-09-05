/**
 * 静态闸门（数据隔离专项·批次 C）：
 * 把「隔离靠人肉记得写 where」变成「漏了就红」。风格沿用仓库既有的闸门测试
 * （如 packages/ui 的 brand.test.ts 用文件内容断言防回退），不引入新依赖。
 *
 * 为什么需要这一层：批次 B 已把归属过滤收口到 ProjectRepository，
 * 但收口这件事本身没有强制力 —— 谁都能在 service 里再写一句 prisma.project.findMany。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const API_SRC = join(REPO_ROOT, 'packages', 'api', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

/**
 * 剥掉注释，只留代码。
 * 闸门判的是「有没有真的这么写」——注释里讲历史（例如"以前这里是 prisma.project.findMany"）
 * 不算违规，否则会像第一版那样把说明文字本身误报成 offender。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 取文件里的纯代码文本 */
const code = (rel: string) => stripComments(read(rel));

describe('数据隔离静态闸门（批次 C）', () => {
  it('除 ProjectRepository 外，api 源码不得直接访问 prisma.project（归属过滤必须走收口层）', () => {
    const offenders = walk(API_SRC)
      .map((f) => relative(f))
      .filter((rel) => !rel.endsWith('project.repository.ts'))
      .filter((rel) => code(rel).includes('prisma.project'));
    expect(offenders).toEqual([]);
    // 白名单文件本身必须存在且确实是收口层（防止有人靠删文件让上面那条断言"空过"）
    const repo = code(join('packages', 'api', 'src', 'projects', 'project.repository.ts'));
    expect(repo).toContain('class ProjectRepository');
    expect(repo).toContain('prisma.project');
  });

  it('saveService 不得再自己碰 localStorage（凭据 key 只允许 auth store 一处定义）', () => {
    // 旧实现硬编码 localStorage.getItem('av_access')，与 useAuthStore 的 LS_ACCESS 常量各写一份，
    // 任一侧改名就静默失效；现在统一走 useAuthStore.getState()
    expect(code(join('apps', 'web', 'src', 'save', 'saveService.ts'))).not.toMatch(/localStorage\./);
  });

  it('schema：Project 必须有 ownerId + 归属索引（隔离与查询性能的根基）', () => {
    const schema = read(join('packages', 'api', 'prisma', 'schema.prisma'));
    const model = /model Project \{[\s\S]*?\n\}/.exec(schema)?.[0] ?? '';
    expect(model).toContain('ownerId    String');
    expect(model).toContain('@@index([ownerId])');
    expect(model).toContain('onDelete: Cascade');
    expect(model).toContain('version');
  });

  it('JwtAuthGuard 必须查库校验账号状态（禁用 / 软删即刻断权，S4）', () => {
    const guard = read(join('packages', 'api', 'src', 'auth', 'jwt-auth.guard.ts'));
    expect(guard).toContain('deletedAt');
    expect(guard).toContain("status !== 'active'");
    expect(guard).toContain('this.prisma.user.findUnique');
  });

  it('生产环境缺配 JWT_SECRET 必须拒绝启动，不得静默兜底成公开常量（S6）', () => {
    const env = read(join('packages', 'api', 'src', 'config', 'env.ts'));
    expect(env).toContain("process.env.NODE_ENV === 'production'");
    expect(env).toContain('throw new Error');
    // auth.module 必须经 resolveJwtSecret，而不是自己写 ?? 'dev-jwt-secret'
    const module = read(join('packages', 'api', 'src', 'auth', 'auth.module.ts'));
    expect(module).toContain('resolveJwtSecret(config)');
    expect(module).not.toContain("?? 'dev-jwt-secret'");
  });

  it('useDocumentStore 的每个写操作都必须过只读门（批次 B 的收口不许被绕过）', () => {
    const lines = read(join('apps', 'web', 'src', 'store', 'useDocumentStore.ts')).split(/\r?\n/);
    // 非写操作：工程载入 / 会话复位 / 新建草稿 / 纯剪贴板复制（都不改 doc 内容）
    const NON_MUTATING = new Set(['loadProject', 'createLocal', 'reset', 'copySelection']);
    const isMethod = (l: string) => /^ {4}([A-Za-z]+): \(/.test(l);
    const nameOf = (l: string) => /^ {4}([A-Za-z]+): \(/.exec(l)![1];

    const offenders: string[] = [];
    lines.forEach((line, i) => {
      if (!isMethod(line) || NON_MUTATING.has(nameOf(line))) return;
      // 守卫必须落在方法体头几行内（放得再远就等于没有）
      if (!lines.slice(i + 1, i + 4).join('\n').includes('isReadOnly()')) {
        offenders.push(nameOf(line));
      }
    });
    expect(offenders).toEqual([]);
    // 扫到的方法数要对得上，防止文件重构后正则空匹配让上面那条断言假通过
    expect(lines.filter(isMethod).length).toBeGreaterThanOrEqual(15);
  });

  it('前端 client 的工程摘要必须携带归属与可操作性字段（S3 的判定只有一处真源）', () => {
    const client = read(join('apps', 'web', 'src', 'api', 'client.ts'));
    const summary = /interface ProjectSummary \{[\s\S]*?\n\}/.exec(client)?.[0] ?? '';
    for (const field of ['ownerId', 'ownerName', 'ownerDeleted', 'canEdit', 'version']) {
      expect(summary).toContain(field);
    }
  });
});

/** 绝对路径 → 仓库根相对路径（统一成正斜杠，避免 Windows 分隔符影响断言可读性） */
function relative(abs: string): string {
  return abs.slice(REPO_ROOT.length + 1).split('\\').join('/');
}
