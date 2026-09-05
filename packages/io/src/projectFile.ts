/**
 * `.archview` 工程文件（T3.4 / FR-I01）：序列化、解析与版本迁移入口。
 *
 * **文件内容就是 Project JSON 本体，不套信封**，两条理由：
 * ① Project 自带 `schemaVersion` / `id` / `name` / `meta`，识别与迁移所需信息已齐；
 * ② 服务端 `Project.dataJson` 存的就是同一形状 ⇒ 导入导出不必转换，
 *    也不会出现「服务器上能开、下载成文件就打不开」这种双标。
 *
 * 严格度与 `core.migrateProject` 刻意不同，别当成不一致：
 * - `migrateProject`（载入边界）面向**自家服务端与 IndexedDB 缓冲**，尽量兜住、少报错；
 * - 本文件的 `parseProjectFile` 面向**用户手工编辑或第三方来源的文件**，
 *   结构损坏时**明确报错而不是静默补出一个空工程**——否则用户导入错文件后看到一片空白，
 *   会以为自己的数据被清空了。
 */
import { SCHEMA_VERSION, migrateProject, type LegacyProject, type Project } from '@archview/core';
import { downloadTextFile } from './download';

/** 文件扩展名（产品文档 §6.1 命名） */
export const ARCHVIEW_EXT = '.archview';
export const ARCHVIEW_MIME = 'application/json;charset=utf-8';

/** 版本迁移函数：把「schemaVersion = N」的原始对象升到 N+1。加法式变更不必登记（migrateProject 兜） */
type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * 迁移链。当前 `SCHEMA_VERSION` 仍为 1（T3.1 的 rows 属可补齐的加法式变更，未升版），
 * 故表为空——但链路本身现在就位：将来引入 gltf 引用等破坏性变更时，
 * 只需在此加一条 `1: migrateV1toV2`，解析路径不用改。
 */
const MIGRATIONS: Record<number, Migration> = {};

export type ParseResult =
  | { ok: true; project: Project; /** 是否补过字段或升过版本（用于给用户一句提示） */ migrated: boolean }
  | { ok: false; error: string };

/** 工程 → 文本（两空格缩进，便于用户 diff 与手改；不写 BOM——JSON 规范不欢迎它） */
export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

/** 必填容器：缺任何一个都说明文件不是完整的工程，静默补成空数组等于把数据「吃掉」 */
const REQUIRED_ARRAYS = ['components', 'rooms', 'zones', 'types'] as const;

function structuralError(raw: Record<string, unknown>): string | null {
  if (typeof raw.schemaVersion !== 'number') {
    return '缺少 schemaVersion，这看起来不是 ArchView 工程文件';
  }
  if (raw.schemaVersion > SCHEMA_VERSION) {
    return `文件版本 v${raw.schemaVersion} 高于本程序支持的 v${SCHEMA_VERSION}，请升级后再打开`;
  }
  if (raw.unit !== undefined && raw.unit !== 'mm') {
    return `本程序只支持 mm 单位，文件里写的是 ${String(raw.unit)}`;
  }
  for (const key of REQUIRED_ARRAYS) {
    if (!Array.isArray(raw[key])) return `工程结构不完整：${key} 缺失或不是数组`;
  }
  if (typeof raw.meta !== 'object' || raw.meta === null) return '工程结构不完整：meta 缺失';
  return null;
}

/**
 * 文本 → 工程。任何一步失败都返回 `{ ok:false, error }`，**不抛异常**：
 * 调用方（导入按钮）要把 error 原样显示给用户，抛异常只会变成控制台里的一行红字。
 */
export function parseProjectFile(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文本（文件可能在传输中被截断）' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: '文件顶层不是对象，不是 ArchView 工程文件' };
  }
  const obj = raw as Record<string, unknown>;
  const version0 = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 0;
  const err = structuralError(obj);
  if (err) return { ok: false, error: err };

  // 逐级升级（当前表为空，恒等于原样返回）
  let version = version0;
  let stepped: Record<string, unknown> = obj;
  while (version < SCHEMA_VERSION) {
    const migration = MIGRATIONS[version];
    if (!migration) {
      return { ok: false, error: `缺少 v${version} → v${version + 1} 的迁移步骤，无法打开该工程` };
    }
    stepped = migration(stepped);
    version += 1;
  }
  const migrated = version !== version0 || !Array.isArray(obj.rows);
  return { ok: true, project: migrateProject(stepped as LegacyProject), migrated };
}

/** 导出工程文件（下载） */
export function downloadProjectFile(project: Project, filename: string): void {
  downloadTextFile(filename, serializeProject(project), ARCHVIEW_MIME);
}

/**
 * 读取用户选中的文件（`<input type=file>` 的 File 对象）。
 * 浏览器专属：node 环境下 File 不存在，故只在此处依赖 `file.text()`，解析逻辑仍在上面可单测。
 */
export async function readProjectFile(file: { text(): Promise<string> }): Promise<ParseResult> {
  try {
    return parseProjectFile(await file.text());
  } catch {
    return { ok: false, error: '文件读取失败（可能被其它程序占用）' };
  }
}
