import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Icon } from '@archview/ui';
import { createEmptyProject, type Project } from '@archview/core';
import { api, ApiError } from '../api/client';
import { useAuthStore } from '../auth/useAuthStore';
import ComponentLibrary from '../components/ComponentLibrary';
import InspectorPanel from '../components/InspectorPanel';
import ShortcutHelpDialog from '../components/ShortcutHelpDialog';
import StatusBar from '../components/StatusBar';
import TopBar from '../components/TopBar';
import Viewport from '../components/Viewport';
import { useAppStore } from '../store/useAppStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { toastError } from '../store/useToastStore';
import { handleShortcut } from '../shortcut';
import {
  idbClearBuffer,
  onDocChanged,
  pickRecoverableData,
  registerUnloadSave,
  resetSaveEngine,
  syncNow,
} from '../save/saveService';

/**
 * 建模主应用（§10.1 布局 + T1.5 工程加载 + T1.6 自动保存）。
 * 顶栏 / 左组件库 / 视口 / 右属性·统计 / 状态栏。
 * 工程数据：后端 JSON 载入 Document（崩溃时优先恢复 IndexedDB 缓冲，FR-P01）。
 */
export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const accessToken = useAuthStore((s) => s.accessToken);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const setUser = useAuthStore((s) => s.setUser);
  const leftOpen = useAppStore((s) => s.leftOpen);
  const rightOpen = useAppStore((s) => s.rightOpen);
  const doc = useDocumentStore((s) => s.doc);
  const loadProject = useDocumentStore((s) => s.loadProject);
  const helpOpen = useAppStore((s) => s.helpOpen);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const loadedRef = useRef(false);

  // 工程 ID 变化（直接切换工程）：复位加载状态
  useEffect(() => {
    loadedRef.current = false;
    setLoaded(false);
    setFailed(false);
  }, [id]);

  // 启动时校验会话有效性（/auth/me；401 先无感刷新，仍失败则回登录页）
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!accessToken) return;
      try {
        const me = await api.me(accessToken);
        if (alive) setUser(me);
      } catch (err) {
        if (!alive) return;
        // 仅 401（会话真过期）才登出；网络错误（API 未启动 / 重启）只提示，避免瞬时抖动清掉登录态
        if (err instanceof ApiError && err.status === 401) {
          void useAuthStore.getState().logout();
        } else {
          toastError('网络异常，暂无法校验登录状态');
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [accessToken, setUser]);

  // 打开工程（T1.5 / T1.6）：拉取后端数据 → 只读判定 → 崩溃恢复判定 → 载入 Document
  useEffect(() => {
    if (!id || !accessToken || loadedRef.current) return;
    let alive = true;
    (async () => {
      try {
        const full = await api.projectsGet(id, accessToken);
        const serverData = full.data as Partial<Project>;
        // 后端数据为空（刚创建）→ 用默认空工程初始化
        const base: Project =
          serverData && serverData.schemaVersion
            ? (serverData as Project)
            : createEmptyProject(full.name);
        // 只读判定（批次 B/S3）：超管凭 PROJECT_VIEW_ALL 能读他人工程，但后端写权限仅属主。
        // 此前这里放任编辑 → 改动永远 PATCH 不上去 → 变成一条永远同步不掉的本地缓冲，
        // 最终在属主本人下次打开时被他当成「自己的未保存修改」写进工程（跨账号污染）。
        const readOnly = !!userId && full.ownerId !== userId;
        useAppStore.getState().setReadOnly(readOnly);
        const { data, restored } = await pickRecoverableData(id, base, full.updatedAt);
        if (!alive) return;
        loadedRef.current = true;
        loadProject({ ...data, name: full.name }, id, full.version ?? null);
        if (readOnly) {
          // 他人工程一律不信本地缓冲：缓冲的作者是超管（或非本人），恢复它会重写属主数据
          resetSaveEngine('saved');
        } else if (restored) {
          resetSaveEngine('dirty');
          toastError('已恢复上次未保存的修改（本地缓冲）');
        } else {
          void idbClearBuffer(id);
          resetSaveEngine('saved');
        }
        useAppStore.getState().setSelected(null);
        setLoaded(true);
      } catch {
        if (alive) {
          setFailed(true);
          toastError('工程加载失败，请返回工程列表重试');
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, accessToken, userId, loadProject]);

  // Document 变更 → dirty + 本地缓冲（仅加载完成后订阅，避免初始载入误标脏）
  useEffect(() => {
    if (!loaded) return;
    const unsubscribe = doc.subscribe(() => onDocChanged());
    return unsubscribe;
  }, [loaded, doc]);

  // 30s 自动保存（FR-P01）+ 卸载前保存
  useEffect(() => {
    if (!loaded) return;
    const timer = window.setInterval(() => {
      if (useAppStore.getState().saveStatus === 'dirty') {
        void syncNow(useAuthStore.getState().accessToken);
      }
    }, 30000);
    const unregisterUnload = registerUnloadSave();
    return () => {
      window.clearInterval(timer);
      unregisterUnload();
      /* P4：SPA 内部路由离开（返回工程列表 / 浏览器前进后退 / 跳个人中心）不会触发
         beforeunload，registerUnloadSave 只管关标签页与刷新。这里兜底同步一次，
         否则改动只落在 IndexedDB 缓冲：列表页「更新时间」是旧值，下次进来还会弹
         「已恢复上次未保存的修改」，用户以为丢了数据。
         走顶栏返回按钮时已先 await 过 syncNow，此时状态为 saved 会直接跳过，不重复请求。 */
      if (useAppStore.getState().saveStatus !== 'saved') {
        void syncNow(useAuthStore.getState().accessToken);
      }
      // 离页时复位只读标记：避免「从他人工程返回列表再进自己工程」时门还锁着
      // （载入 effect 也会重设，这里是双保险）
      useAppStore.getState().setReadOnly(false);
      useAppStore.getState().setSaveBlocked(null);
    };
  }, [loaded]);

  // 全局快捷键（T2.7 / §10.3 全套：键位解析 + 动作分发收口在 shortcuts.ts）：
  // 输入框 / 文本域聚焦不触发；弹窗 / 2D 右键菜单打开时 Esc 让位浮层先关（overlays 注册表）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      handleShortcut(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // P1 响应式：窄屏（≤ 1280px）自动折叠两侧面板，把宽度让给视口
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1280px)');
    const sync = () => {
      if (mq.matches) useAppStore.setState({ leftOpen: false, rightOpen: false });
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  if (failed) {
    return (
      <div className="center-page">
        <div className="center-card">
          <h2>工程加载失败</h2>
          <p className="muted">可能已删除或无权限</p>
          <a href="/" className="btn">
            ← 返回工程列表
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-body">
        <aside className={`app-left${leftOpen ? '' : ' collapsed'}`}>
          <ComponentLibrary />
        </aside>
        <main className="app-viewport">
          {!leftOpen && (
            <button
              className="panel-handle panel-handle-left"
              onClick={() => useAppStore.getState().toggleLeft()}
              title="展开组件库面板（B）"
              aria-label="展开组件库面板"
            >
              <Icon name="chevron-right" size={14} />
            </button>
          )}
          {!rightOpen && (
            <button
              className="panel-handle panel-handle-right"
              onClick={() => useAppStore.getState().toggleRight()}
              title="展开属性面板（I）"
              aria-label="展开属性面板"
            >
              <Icon name="chevron-left" size={14} />
            </button>
          )}
          {loaded ? (
            <Viewport key={doc.project.id} />
          ) : (
            <div className="viewport-placeholder">
              <span className="spinner" aria-hidden="true" />
              <p className="muted">正在打开工程…</p>
            </div>
          )}
        </main>
        <aside className={`app-right${rightOpen ? '' : ' collapsed'}`}>
          <InspectorPanel />
        </aside>
      </div>
      <StatusBar />
      {/* 快捷键帮助（T2.7 / §10.3 '?'；顶栏「帮助」按钮同一开关） */}
      <ShortcutHelpDialog open={helpOpen} onClose={() => useAppStore.getState().setHelpOpen(false)} />
    </div>
  );
}
