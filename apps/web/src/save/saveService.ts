/**
 * 工程自动保存（FR-P01 / T1.6）+ 账号数据隔离：
 * - 变更 → 400ms 防抖写 IndexedDB 本地缓冲（崩溃 / 刷新不丢）；
 * - 30s 自动同步后端 + 手动保存（Ctrl+S）+ 卸载前尽力同步（keepalive）；
 * - 打开工程时崩溃恢复：本地缓冲比服务端新 **且属于当前账号** → 采用缓冲并提示。
 * 保存状态（saved / dirty / saving）写入 useAppStore.saveStatus，顶栏指示。
 *
 * ⚠️ 隔离口径（数据隔离专项·批次 A）：缓冲主键为 `${ownerId}:${projectId}`。
 * v1 只有 projectId 一个维度，于是「超管打开他人工程 → PATCH 必 404（写权限仅属主）
 * → 改动永远留在本地缓冲」，会在属主本人下次打开同一工程时被 `pickRecoverableData`
 * 误判成「他自己的未保存修改」而写进属主工程 —— 跨账号数据污染。现在三层收口：
 * ① 主键带属主；② 恢复前校验属主（`chooseRecovery`）；③ 4xx 不再无限重试刷时间戳。
 */
import type { Project } from '@archview/core';
import { api, API_BASE, ApiError, type AuthToken } from '../api/client';
import { useAuthStore } from '../auth/useAuthStore';
import { useAppStore } from '../store/useAppStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { toastError } from '../store/useToastStore';

const DB_NAME = 'archview-save';
/** v2：主键由 `projectId` 改为 `${ownerId}:${projectId}`（见文件头说明） */
const DB_VERSION = 2;
const STORE = 'buffers';

/** 本地缓冲条目 */
export interface SaveBuffer {
  /** 隔离主键：`${ownerId}:${projectId}`（cuid 不含冒号，拼接安全） */
  key: string;
  /** 写入该缓冲时所在的账号 ID */
  ownerId: string;
  projectId: string;
  data: Project;
  /** 本地写入时间戳（ms） */
  savedAt: number;
}

/** 缓冲主键（纯函数，导出供单测） */
export function bufferKey(ownerId: string, projectId: string): string {
  return `${ownerId}:${projectId}`;
}

/** 该缓冲是否属于当前账号（纯函数，导出供单测；未登录时一律不认） */
export function isBufferOwnedBy(buf: Pick<SaveBuffer, 'ownerId'>, userId: string | null): boolean {
  return !!userId && buf.ownerId === userId;
}

/**
 * 崩溃恢复判定（纯函数，导出供单测）：
 * - 缓冲不属于当前账号 → 拒用，并标记 `staleForeign` 让调用方顺手清理（他人残留不该占空间）；
 * - 本地比服务端新 2s 以上才认为「确有未同步成功」的改动（容差防时钟抖动）。
 */
export function chooseRecovery(
  buf: SaveBuffer | null,
  serverUpdatedAt: string,
  userId: string | null,
): { accept: boolean; staleForeign: boolean } {
  if (!buf) return { accept: false, staleForeign: false };
  if (!isBufferOwnedBy(buf, userId)) return { accept: false, staleForeign: true };
  return { accept: buf.savedAt > new Date(serverUpdatedAt).getTime() + 2000, staleForeign: false };
}

/** 当前账号 ID（未登录 / 登出流程中为 null：此时不允许读写缓冲，避免留下无主残留） */
function currentUserId(): string | null {
  try {
    return useAuthStore.getState().user?.id ?? null;
  } catch {
    return null;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onblocked = () => {
        // 别的标签页还持有 v1 连接 → 升级排不上队。不提示的话这里会一直挂着像「卡死」。
        console.warn('[save] IndexedDB 升级被阻塞：请关闭本系统的其它标签页后刷新页面');
      };
      req.onupgradeneeded = () => {
        const db = req.result;
        if (db.objectStoreNames.contains(STORE)) {
          // v1 → v2：主键结构变了，且旧条目无从判定作者归属（错认比丢弃更危险）→
          // 直接删除可再生缓冲重建。代价：升级当天「尚未同步成功」的本地缓冲会丢一次，
          // 工程数据本体在服务端，已同步的不受影响。
          db.deleteObjectStore(STORE);
        }
        db.createObjectStore(STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 批量删除（tx() 只支持单请求，删除多条要走事务完成事件收口） */
async function idbDeleteKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    for (const k of keys) store.delete(k);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function idbSaveBuffer(projectId: string, data: Project): Promise<void> {
  const ownerId = currentUserId();
  if (!ownerId) return;
  const entry: SaveBuffer = {
    key: bufferKey(ownerId, projectId),
    ownerId,
    projectId,
    data,
    savedAt: Date.now(),
  };
  await tx('readwrite', (s) => s.put(entry));
}

export async function idbLoadBuffer(projectId: string): Promise<SaveBuffer | null> {
  const ownerId = currentUserId();
  if (!ownerId) return null;
  try {
    const entry = await tx<SaveBuffer | undefined>(
      'readonly',
      (s) => s.get(bufferKey(ownerId, projectId)) as IDBRequest<SaveBuffer | undefined>,
    );
    return entry ?? null;
  } catch {
    return null;
  }
}

export async function idbClearBuffer(projectId: string): Promise<void> {
  const ownerId = currentUserId();
  if (!ownerId) return;
  try {
    await tx('readwrite', (s) => s.delete(bufferKey(ownerId, projectId)));
  } catch {
    /* 缓冲清理失败不影响主流程 */
  }
}

/**
 * 登出清理：仅删除「不属于该账号」的缓冲。
 * 本人条目保留 —— 崩溃 / 断网时的未同步改动要在下次登录后仍能恢复（FR-P01）；
 * 他人条目必须清掉：既消灭跨账号污染，也不让上一位用户的工程内容留在共享工位浏览器里。
 */
export async function idbPurgeNotMine(userId: string | null): Promise<void> {
  try {
    const all = await tx<SaveBuffer[]>('readonly', (s) => s.getAll() as IDBRequest<SaveBuffer[]>);
    await idbDeleteKeys(all.filter((e) => e.ownerId !== userId).map((e) => e.key));
  } catch {
    /* 缓冲清理失败不影响登出主流程 */
  }
}

/* ---------- 保存引擎（模块级单例） ---------- */

let flushTimer: number | null = null;
let syncing = false;
let lastSyncAt = 0;

/**
 * 重置保存引擎（打开工程后调用）：清掉残留的防抖写盘定时器，并设置初始保存状态。
 * 避免「上一个工程的未落盘定时器」把新工程数据误写进缓冲。
 */
export function resetSaveEngine(status: 'saved' | 'dirty'): void {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  lastSyncAt = Date.now();
  useAppStore.getState().setSaveStatus(status);
}

/**
 * 停止保存引擎（登出 / 会话清理时由 teardown 回调调用）：
 * 防抖定时器一旦跨账号存活，就会把上一个账号的工程数据写进缓冲（S1 的同源问题）。
 */
export function stopSaveEngine(): void {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  syncing = false;
  lastSyncAt = 0;
}

/** Document 变更回调（ProjectPage 订阅后调用）：置 dirty + 防抖落本地缓冲 */
export function onDocChanged(): void {
  useAppStore.getState().setSaveStatus('dirty');
  if (flushTimer !== null) window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    const app = useAppStore.getState();
    // 只读工程（他人工程）不落缓冲：这份改动永远同步不上去，留着只会被误当「未保存修改」
    if (app.readOnly) return;
    const { doc, projectId } = useDocumentStore.getState();
    if (projectId) void idbSaveBuffer(projectId, doc.project);
  }, 400);
}

/**
 * 立即同步后端（手动保存 / 30s 自动 / 卸载前尽力）。
 * 成功后清本地缓冲；网络类失败回退 dirty 并保留缓冲（下次恢复）；
 * 4xx（无写权限 / 工程已不在）丢弃缓冲并转只读 —— 重试永远不会成功，
 * 留在本地反而会在属主下次打开时污染其工程（批次 A 的收口点）。
 */
export async function syncNow(token: AuthToken | null): Promise<boolean> {
  const { doc, projectId, serverVersion } = useDocumentStore.getState();
  if (!projectId || !token || syncing) return true;
  if (useAppStore.getState().readOnly) return true;
  syncing = true;
  useAppStore.getState().setSaveStatus('saving');
  try {
    const res = await api.projectsUpdate(
      projectId,
      // baseVersion（批次 D / S9）：带上载入时的版本号，服务端不符即 409，
      // 不再让多标签页 / 多端各持一份全量 dataJson 静默互相覆盖
      serverVersion === null ? { data: doc.project } : { data: doc.project, baseVersion: serverVersion },
      token,
    );
    lastSyncAt = Date.now();
    if (typeof res?.version === 'number') useDocumentStore.setState({ serverVersion: res.version });
    useAppStore.getState().setSaveStatus('saved');
    useAppStore.getState().setSaveBlocked(null);
    void idbClearBuffer(projectId);
    return true;
  } catch (err) {
    // 409：他端已更新 → 保留缓冲（这是本账号的真改动，不能丢），停止自动重试并提示人工处置
    if (err instanceof ApiError && err.status === 409) {
      useAppStore.getState().setSaveStatus('dirty');
      useAppStore.getState().setSaveBlocked(err.message);
      void idbSaveBuffer(projectId, doc.project);
      toastError(`${err.message}（改动已保留在本地，请先导出备份再刷新载入最新版）`);
      return false;
    }
    // 401 不在此列：client.ts 已做过一次无感刷新，仍失败代表会话问题，数据必须留在本地等重登
    const forbidden =
      err instanceof ApiError && (err.status === 403 || err.status === 404 || err.status === 410);
    if (forbidden) {
      useAppStore.getState().setSaveStatus('saved');
      useAppStore.getState().setReadOnly(true);
      const reason =
        err.status === 404 || err.status === 410
          ? '该工程已不存在或已被删除，本地未同步的改动已丢弃'
          : '当前账号对该工程没有写入权限，本地未同步的改动已丢弃';
      useAppStore.getState().setSaveBlocked(reason);
      void idbClearBuffer(projectId);
      toastError(reason);
      return false;
    }
    useAppStore.getState().setSaveStatus('dirty');
    void idbSaveBuffer(projectId, doc.project);
    return false;
  } finally {
    syncing = false;
  }
}

/** 崩溃恢复判定：缓冲须属于当前账号，且比服务端更新（2s 容差防时钟抖动） */
export async function pickRecoverableData(
  projectId: string,
  serverData: Project,
  serverUpdatedAt: string,
): Promise<{ data: Project; restored: boolean }> {
  const buf = await idbLoadBuffer(projectId);
  const { accept, staleForeign } = chooseRecovery(buf, serverUpdatedAt, currentUserId());
  if (staleForeign) {
    // 他人的残留（例如上一位用户在这台机器上留下的）：顺手删掉，绝不能用
    void idbPurgeNotMine(currentUserId());
    return { data: serverData, restored: false };
  }
  if (buf && accept) return { data: buf.data, restored: true };
  return { data: serverData, restored: false };
}

/**
 * 注册卸载前保存（页面关闭 / 刷新）：
 * 1) 本地缓冲补写（防抖窗口内未落盘的部分）；
 * 2) keepalive 尽力同步后端（浏览器在 unload 期间仍会发出）。
 * 只读工程两步都跳过：既不该落缓冲，也不该发注定 4xx 的请求。
 */
export function registerUnloadSave(): () => void {
  const onUnload = () => {
    const app = useAppStore.getState();
    if (app.readOnly) return;
    const { doc, projectId, serverVersion } = useDocumentStore.getState();
    if (!projectId) return;
    void idbSaveBuffer(projectId, doc.project);
    // 走 auth store 取 token：此前这里硬编码 localStorage 的 'av_access' 字面量，
    // 与 useAuthStore 的 LS_ACCESS 常量各写一份，任一侧改名就会静默失效（登出后串号窗口即中招）
    const token = readAccessToken();
    if (token && Date.now() - lastSyncAt > 3000) {
      fetch(`${API_BASE}/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          data: doc.project,
          ...(serverVersion !== null ? { baseVersion: serverVersion } : {}),
        }),
        keepalive: true,
      }).catch(() => {
        /* 卸载阶段网络失败由本地缓冲兜底 */
      });
    }
  };
  window.addEventListener('beforeunload', onUnload);
  return () => window.removeEventListener('beforeunload', onUnload);
}

/** 惰性读取访问令牌（不订阅 store 变化，避免与 auth store 的渲染耦合） */
function readAccessToken(): string | null {
  try {
    return useAuthStore.getState().accessToken;
  } catch {
    return null;
  }
}
