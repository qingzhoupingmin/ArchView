/**
 * ArchView 前端 API 客户端。
 * 约定（产品文档 §8.4）：/api/v1 前缀；错误体 { code, message, detail? }；401 无感刷新（FR-U03）。
 */
import { t } from '../i18n';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    /** 业务细节（如 LOGIN_LOCKED 的 retryAfter 秒数，产品文档 §8.4 detail?） */
    public detail?: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface AuthUser {
  id: string;
  username: string;
  nickname: string;
  role: 'super_admin' | 'user';
  email: string | null;
  avatar: string | null;
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
}

export interface LoginResult {
  access: string;
  refresh: string;
  user: AuthUser;
  mustChangePassword: boolean;
}

/** 工程列表条目（T1.5；数据隔离专项·批次 B 补归属与可操作标记） */
export interface ProjectSummary {
  id: string;
  name: string;
  visibility: string;
  /** 属主用户 ID */
  ownerId: string;
  /** 属主显示名（超管「查看全部工程」时用来区分归属，避免几十个同名卡片分不清） */
  ownerName: string;
  /** 属主已被软删（工程成为无主孤儿，需超管清理） */
  ownerDeleted: boolean;
  /** 本账号能否写该工程：写权限仅属主，超管也为 false —— 前端据此置灰行内操作 */
  canEdit: boolean;
  /** 乐观锁版本号（批次 D） */
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** 工程详情（T1.5：data 为 core Project JSON，FR-I01 同源） */
export interface ProjectFull {
  id: string;
  name: string;
  visibility: string;
  ownerId: string;
  canEdit: boolean;
  version: number;
  updatedAt: string;
  data: Record<string, unknown>;
}

/** 用户列表条目（FR-U05 / T1.3） */
export interface UserSummary {
  id: string;
  username: string;
  nickname: string;
  role: 'super_admin' | 'user';
  email: string | null;
  avatar: string | null;
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

/** 操作日志条目（FR-U09 / 批次 D） */
export interface AuditItem {
  id: string;
  userId: string | null;
  ip: string | null;
  /** login / login.fail / project.read_foreign / user.delete …（后端 AUDIT 常量） */
  action: string;
  target: string | null;
  /** 详情 JSON 字符串（后端按 SQLite 无 jsonb 处理，前端按需 parse） */
  detail: string | null;
  createdAt: string;
}

export interface AuditPage {
  total: number;
  limit: number;
  offset: number;
  items: AuditItem[];
}

/**
 * API 基址（产品文档 §8.4：/api/v1 前缀）。
 *
 * 相对路径 /api/v1（与页面同源 → 既无跨域、也不触发混合内容拦截）适用于三类入口：
 * - 本地开发（localhost / 127.0.0.1）：由 vite 代理转发到 127.0.0.1:3007（见 vite.config.ts）；
 * - API 同端口部署（标准 :3007，前端由 API 托管静态构建，见 packages/api/src/main.ts）；
 * - **https 页面**（如 Tailscale Serve / Funnel 把 :443 同域反代到 3007）——
 *   此场景绝不能再拼 `:3007`：3007 只监听明文 HTTP，拼上去既握不上 TLS，
 *   改成 http 又会被浏览器按混合内容拦截，表现为「页面能打开、登录必失败」。
 *
 * 页面在其它端口的 http 入口（如 IIS :80 托管静态页）：显式定位同机 3007，
 * 此时属跨域，服务端 CORS_ORIGIN 必须包含该页面 origin。
 *
 * 特殊部署（API 与页面不同机等）可用构建期变量 VITE_API_BASE 强制覆盖；
 * 注意 Vite 的 envDir 是 apps/web，根目录 .env 不会注入前端构建，
 * 需写在 apps/web/.env 或以构建期环境变量传入。
 */
const isLocalHost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
/** API 与页面同源：https 反代入口（Serve / Funnel）或直连标准 :3007 端口 */
const isSameOriginApi =
  typeof window !== 'undefined' &&
  (window.location.protocol === 'https:' || window.location.port === '3007');

/** 构建期覆盖（去尾部斜杠）；未设置时为 undefined，走下方同源 / 跨端口判定 */
const envBase = import.meta.env.VITE_API_BASE?.replace(/\/+$/, '');
/** 跨端口 http 入口（IIS :80 等）：显式指向同机 3007 */
const crossPortBase =
  typeof window === 'undefined'
    ? '/api/v1' // node（SSR / 测试）环境回退相对路径
    : `${window.location.protocol}//${window.location.hostname}:3007/api/v1`;

const BASE: string = envBase || (isLocalHost || isSameOriginApi ? '/api/v1' : crossPortBase);

/** API 基址（saveService 的 keepalive 卸载保存等直接 fetch 场景使用） */
export const API_BASE = BASE;

/** 访问令牌类型 */
export type AuthToken = string | null;

type RefreshHandler = () => Promise<string | null>;
let refreshHandler: RefreshHandler | null = null;

/** 由 auth store 注册 401 无感刷新逻辑（避免 client ↔ store 循环依赖） */
export function setRefreshHandler(fn: RefreshHandler | null): void {
  refreshHandler = fn;
}

interface ReqOpts {
  method?: string;
  body?: unknown;
  token?: string | null;
  /** 401 时是否允许刷新重试（默认 true；/auth/* 接口关闭） */
  retryOn401?: boolean;
}

export async function request<T>(path: string, opts: ReqOpts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const hasBody = opts.body !== undefined;
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? (hasBody ? 'POST' : 'GET'),
    headers,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && opts.retryOn401 !== false && refreshHandler) {
    const fresh = await refreshHandler();
    if (fresh) return request<T>(path, { ...opts, token: fresh, retryOn401: false });
  }

  if (!res.ok) {
    let code = 'HTTP_ERROR';
    // 非 JSON 错误体的兜底文案走 i18n（T4.2 首个真实 key，带 {{status}} 插值）
    let message = t('api.requestFailed', { status: res.status });
    let detail: Record<string, unknown> | null = null;
    try {
      const data = (await res.json()) as {
        code?: string;
        message?: string;
        detail?: Record<string, unknown>;
      };
      if (data.code) code = data.code;
      if (data.message) message = data.message;
      detail = data.detail ?? null;
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new ApiError(code, message, res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  // ---- 认证（FR-U01 / U03） ----
  login: (body: { username: string; password: string }) =>
    request<LoginResult>('/auth/login', { body }),
  refresh: (refresh: string) =>
    request<{ access: string; refresh: string }>('/auth/refresh', {
      body: { refresh },
      retryOn401: false,
    }),
  logout: (refresh: string, token?: string | null) =>
    request<void>('/auth/logout', { body: { refresh }, token }),
  me: (token?: string | null) => request<AuthUser>('/auth/me', { token }),

  // ---- 个人资料（FR-U04 / T1.2：GET/PATCH /me · POST /me/password） ----
  mePatch: (body: { nickname?: string; email?: string; avatar?: string }, token: string) =>
    request<AuthUser>('/me', { method: 'PATCH', body, token }),
  mePassword: (body: { oldPassword: string; newPassword: string }, token: string) =>
    request<AuthUser>('/me/password', { body, token }),

  // ---- 工程管理（T1.5） ----
  projectsList: (token: string) => request<ProjectSummary[]>('/projects', { token }),
  projectsCreate: (body: { name: string }, token: string) =>
    request<ProjectSummary>('/projects', { body, token }),
  projectsGet: (id: string, token: string) => request<ProjectFull>(`/projects/${id}`, { token }),
  /** baseVersion（批次 D / S9）：取自 projectsGet 的 version，服务端不一致 → 409 PROJECT_CONFLICT */
  projectsUpdate: (
    id: string,
    body: { name?: string; data?: unknown; baseVersion?: number },
    token: string,
  ) => request<ProjectSummary>(`/projects/${id}`, { method: 'PATCH', body, token }),
  projectsRemove: (id: string, token: string) =>
    request<{ id: string }>(`/projects/${id}`, { method: 'DELETE', token }),

  // ---- 用户管理（FR-U05 / T1.3，仅超管） ----
  usersList: (token: string, query: { q?: string; role?: string; status?: string } = {}) => {
    const qs = new URLSearchParams();
    if (query.q) qs.set('q', query.q);
    if (query.role) qs.set('role', query.role);
    if (query.status) qs.set('status', query.status);
    const s = qs.toString();
    return request<UserSummary[]>(`/users${s ? `?${s}` : ''}`, { token });
  },
  usersCreate: (
    body: {
      username: string;
      password: string;
      nickname?: string;
      role?: 'user' | 'super_admin';
      email?: string;
    },
    token: string,
  ) => request<UserSummary>('/users', { body, token }),
  usersSetStatus: (id: string, status: 'active' | 'disabled', token: string) =>
    request<UserSummary>(`/users/${id}/status`, { method: 'PATCH', body: { status }, token }),
  usersResetPassword: (id: string, password: string, token: string) =>
    request<UserSummary>(`/users/${id}/password`, { body: { password }, token }),
  usersSetRole: (id: string, role: 'user' | 'super_admin', token: string) =>
    request<UserSummary>(`/users/${id}/role`, { method: 'PATCH', body: { role }, token }),
  usersRemove: (id: string, token: string, purge = false) =>
    request<{ id: string; purged: boolean }>(
      `/users/${id}${purge ? '?purge=true' : ''}`,
      { method: 'DELETE', token },
    ),

  // ---- 操作日志（FR-U09 / 批次 D，仅持 oplog:view 的超管） ----
  auditList: (
    token: string,
    query: { userId?: string; action?: string; target?: string; limit?: number; offset?: number } = {},
  ) => {
    const qs = new URLSearchParams();
    if (query.userId) qs.set('userId', query.userId);
    if (query.action) qs.set('action', query.action);
    if (query.target) qs.set('target', query.target);
    if (query.limit !== undefined) qs.set('limit', String(query.limit));
    if (query.offset !== undefined) qs.set('offset', String(query.offset));
    const s = qs.toString();
    return request<AuditPage>(`/audit${s ? `?${s}` : ''}`, { token });
  },
};
