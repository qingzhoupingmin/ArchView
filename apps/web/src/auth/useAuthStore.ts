import { create } from 'zustand';
import { api, setRefreshHandler, type AuthUser } from '../api/client';

const LS_ACCESS = 'av_access';
const LS_REFRESH = 'av_refresh';
const LS_USER = 'av_user';

function loadUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(LS_USER);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function clearStorage(): void {
  localStorage.removeItem(LS_ACCESS);
  localStorage.removeItem(LS_REFRESH);
  localStorage.removeItem(LS_USER);
}

/**
 * 会话清理回调（数据隔离专项·批次 A/S2）。
 * 由 main.tsx 注册 —— auth store 不能直接 import 业务 store 与 saveService：
 * saveService 反过来要读这里的 token 与 user.id，直接引会成环（同 client.ts 的 setRefreshHandler 约定）。
 * 登出 / 会话失效都必须走它，否则上一个账号的工程数据会留在内存与本地缓冲里串号。
 */
export type SessionTeardown = (prevUserId: string | null) => void | Promise<void>;
let sessionTeardown: SessionTeardown | null = null;

export function setSessionTeardown(fn: SessionTeardown | null): void {
  sessionTeardown = fn;
}

/** 执行会话清理（回调抛错也不能拦住登出，否则用户会卡在「登不出去」） */
async function runTeardown(prevUserId: string | null): Promise<void> {
  try {
    await sessionTeardown?.(prevUserId);
  } catch {
    /* 清理失败不阻塞登出 */
  }
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  /** 401 无感刷新（FR-U03）：并发 401 共享同一个刷新请求 */
  refreshOnce: () => Promise<string | null>;
  setUser: (user: AuthUser) => void;
}

let refreshing: Promise<string | null> | null = null;

// SSR / node 环境无 localStorage（模块作用域求值需守卫；动作内的调用只发生在浏览器交互期）
const hasLocalStorage = typeof localStorage !== 'undefined';

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: hasLocalStorage ? localStorage.getItem(LS_ACCESS) : null,
  refreshToken: hasLocalStorage ? localStorage.getItem(LS_REFRESH) : null,
  user: loadUser(),

  login: async (username, password) => {
    const data = await api.login({ username, password });
    // 不登出直接换账号（同浏览器）：上一个账号的工程数据与本地缓冲必须先清，
    // 否则内存里的旧 doc 会被导出 / 顶栏读到（批次 A/S2 的另一半场景）。
    const prevUserId = get().user?.id ?? null;
    if (prevUserId && prevUserId !== data.user.id) await runTeardown(prevUserId);
    localStorage.setItem(LS_ACCESS, data.access);
    localStorage.setItem(LS_REFRESH, data.refresh);
    localStorage.setItem(LS_USER, JSON.stringify(data.user));
    set({ accessToken: data.access, refreshToken: data.refresh, user: data.user });
    return data.user;
  },

  logout: async () => {
    const { refreshToken } = get();
    // 先记下「登出前是谁」：teardown 要按这个 ID 判断哪些本地缓冲属于他人、该清掉
    const prevUserId = get().user?.id ?? null;
    if (refreshToken) {
      try {
        await api.logout(refreshToken);
      } catch {
        /* 登出失败不阻塞本地会话清理 */
      }
    }
    // 顺序要紧：先清业务态（保存引擎 / 工程数据 / 他人本地缓冲），再清凭据。
    // 反过来做会让 saveService 取不到 user.id，无从定位该清哪些缓冲（批次 A/S2）。
    await runTeardown(prevUserId);
    clearStorage();
    set({ accessToken: null, refreshToken: null, user: null });
  },

  refreshOnce: () => {
    if (!refreshing) {
      refreshing = (async () => {
        const { refreshToken: rt } = get();
        if (!rt) return null;
        try {
          const data = await api.refresh(rt);
          localStorage.setItem(LS_ACCESS, data.access);
          localStorage.setItem(LS_REFRESH, data.refresh);
          set({ accessToken: data.access, refreshToken: data.refresh });
          return data.access;
        } catch {
          // 刷新失败 = 会话真没了（被禁用 / 吊销 / 过期）：同样要走业务态清理
          await runTeardown(get().user?.id ?? null);
          clearStorage();
          set({ accessToken: null, refreshToken: null, user: null });
          return null;
        } finally {
          // 延迟清空，避免同批并发请求在 finally 后仍拿到旧 promise
          setTimeout(() => {
            refreshing = null;
          }, 0);
        }
      })();
    }
    return refreshing;
  },

  setUser: (user) => {
    localStorage.setItem(LS_USER, JSON.stringify(user));
    set({ user });
  },
}));

// 注册 401 无感刷新（client 侧调用）
setRefreshHandler(() => useAuthStore.getState().refreshOnce());
