import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 审计动作常量（避免各处手写字符串漂移；查询筛选也用同一份） */
export const AUDIT = {
  LOGIN: 'login',
  LOGIN_FAIL: 'login.fail',
  /** 命中锁定被拒（含 retryAfter，便于排查是否被针对） */
  LOGIN_LOCKED: 'login.locked',
  /** 无感刷新换发新令牌对 */
  REFRESH: 'refresh',
  LOGOUT: 'logout',
  PASSWORD_CHANGE: 'password.change',
  PROJECT_CREATE: 'project.create',
  /** 超管凭 project:view-all 读他人工程 —— 数据隔离最需要的留痕点 */
  PROJECT_READ_FOREIGN: 'project.read_foreign',
  PROJECT_UPDATE: 'project.update',
  PROJECT_DELETE: 'project.delete',
  PROJECT_CONFLICT: 'project.conflict',
  USER_CREATE: 'user.create',
  USER_STATUS: 'user.status',
  USER_ROLE: 'user.role',
  USER_RESET_PASSWORD: 'user.reset_password',
  USER_DELETE: 'user.delete',
  USER_PURGE: 'user.purge',
} as const;

export type AuditAction = (typeof AUDIT)[keyof typeof AUDIT];

export interface AuditEntry {
  userId?: string | null;
  ip?: string | null;
  action: AuditAction | string;
  target?: string | null;
  detail?: unknown;
}

export interface AuditQuery {
  userId?: string;
  action?: string;
  target?: string;
  /** ISO 时间串，含下限 */
  from?: string;
  to?: string;
  limit?: string | number;
  offset?: string | number;
}

/**
 * 操作日志（FR-U09 · 数据隔离专项批次 D 提前接入）。
 * 产品文档把 FR-U09 排在 P3，但本次隔离整改没有「谁读过 / 改过谁的工程」的留痕，
 * 串号事故就无从追溯 —— 故与批次 A/B 同期落地最小版。
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  /** 在途写入（fire-and-forget 的副作用）：测试与关服前可 flush() 等待落盘 */
  private readonly pending = new Set<Promise<unknown>>();

  // @Inject 显式令牌：不依赖 design:paramtypes（esbuild/tsx/vitest 转换下元数据可能缺失）
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * 记一条日志（不返回 Promise、不抛错）：审计是旁路，
   * 绝不能因为日志写失败就把用户的保存请求打挂。
   */
  record(entry: AuditEntry): void {
    const p = this.prisma.auditLog
      .create({
        data: {
          userId: entry.userId ?? null,
          ip: entry.ip ?? null,
          action: entry.action,
          target: entry.target ?? null,
          detail: entry.detail === undefined ? null : safeJson(entry.detail),
        },
      })
      .catch((err: unknown) => {
        this.logger.warn(`[audit] 写入失败（${entry.action}）：${(err as Error).message}`);
      });
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  /** 等待全部在途日志落盘（集成测试断言前调用） */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  /** 分页查询（仅超管，控制器侧用 OP_LOG_VIEW 权限点守卫） */
  async list(query: AuditQuery) {
    const limit = clampInt(query.limit, 50, 1, 200);
    const offset = clampInt(query.offset, 0, 0, 100_000);
    // 时间串先校验：非法值直接给 null，否则 new Date('abc') 会让 Prisma 抛 500
    const from = toDate(query.from);
    const to = toDate(query.to);
    const where = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.target ? { target: query.target } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
      }),
    ]);
    return {
      total,
      limit,
      offset,
      items: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        ip: r.ip,
        action: r.action,
        target: r.target,
        detail: r.detail,
        createdAt: r.createdAt,
      })),
    };
  }
}

/** detail 允许传对象：统一序列化为字符串存（SQLite 无 jsonb） */
function safeJson(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return '"[unserializable]"';
  }
}

function clampInt(raw: string | number | undefined, fallback: number, min: number, max: number) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** ISO 时间串 → Date；非法或空值返回 null（避免 Prisma 拿到 Invalid Date 直接 500） */
function toDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
