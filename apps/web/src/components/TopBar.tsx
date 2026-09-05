import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { PERMISSIONS } from '@archview/core';
import {
  ARCHVIEW_EXT,
  dataUrlToBlob,
  dateStamp,
  downloadBlob,
  downloadProjectFile,
  downloadTextFile,
  powerReportCsv,
  readProjectFile,
  safeFileName,
} from '@archview/io';
import { useNavigate } from 'react-router-dom';
import { BrandMark, Icon, UserMenu } from '@archview/ui';
import { useAuthStore } from '../auth/useAuthStore';
import { usePermission } from '../auth/usePermission';
import { useAppStore } from '../store/useAppStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { useThemeStore } from '../store/useThemeStore';
import { toastError, toastSuccess } from '../store/useToastStore';
import { viewportRef } from '../store/viewportRef';
import { syncNow } from '../save/saveService';
import RoomDialog from './RoomDialog';

/**
 * 建模页顶栏（§10.1 / T1.7）：三段式布局——
 * 左【返回 + 品牌 + 工程名 + 保存状态】· 中【撤销重做 / 3D·2D / 导出】· 右【面板开关 + 用户菜单】。
 * P1：此前所有控件挤在右侧一组、中间大片空白且无分组分隔。
 * P3 阶段 C：① 图标改由 @archview/ui 的 Icon 提供（原先是本文件手写的 5 个内联 SVG）；
 *            ② 用户菜单抽成 UserMenu 与 AppHeader 共用 —— 此前两处各写一份，
 *               且 TopBar 这一份漏了「切换深色」，导致建模页里找不到主题开关。
 * P4：补「← 工程列表」显式返回按钮。此前回主界面唯一的入口是工程名标签
 *     （.topbar-project），它默认态毫无按钮特征，用户根本发现不了（截图反馈）。
 *     同时返回前先同步：SPA 内部路由切换不会触发 beforeunload，
 *     不 flush 的话改动只落在 IndexedDB 缓冲里，列表「更新时间」是旧的、
 *     下次进来还会弹「已恢复上次未保存的修改」，像丢了数据。
 * 保存状态：saved 绿 / dirty 橙 / saving 粉（FR-P01）。
 */

/** 历史条目时间展示：HH:mm:ss（T2.4 / FR-M08） */
function formatHistoryTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}
export default function TopBar() {
  const navigate = useNavigate();
  const viewMode = useAppStore((s) => s.viewMode);
  const leftOpen = useAppStore((s) => s.leftOpen);
  const rightOpen = useAppStore((s) => s.rightOpen);
  const canUndo = useDocumentStore((s) => s.doc.canUndo);
  const canRedo = useDocumentStore((s) => s.doc.canRedo);
  const doc = useDocumentStore((s) => s.doc);
  const rev = useDocumentStore((s) => s.rev);
  const projectName = useDocumentStore((s) => s.doc.project.name);
  const saveStatus = useAppStore((s) => s.saveStatus);
  const readOnly = useAppStore((s) => s.readOnly);
  const saveBlocked = useAppStore((s) => s.saveBlocked);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const themeMode = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const can = usePermission();
  /** 房间创建弹窗开关（T2.8） */
  const [roomOpen, setRoomOpen] = useState(false);
  /** 历史列表下拉开关（T2.4 / FR-M08「历史列表可查」） */
  const [historyOpen, setHistoryOpen] = useState(false);
  /** 导出 / 导入菜单（T3.3 报表 + T3.4 工程文件），与「历史」下拉同一套范式 */
  const [exportOpen, setExportOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const powerIndex = useDocumentStore((s) => s.powerIndex);
  const projectId = useDocumentStore((s) => s.projectId);
  const serverVersion = useDocumentStore((s) => s.serverVersion);

  /** 导出电力统计 CSV（FR-A05）：数字取自统计索引 ⇒ 与面板永远同源 */
  const onExportCsv = () => {
    setExportOpen(false);
    const stats = powerIndex.get();
    if (stats.componentCount === 0) {
      toastError('工程还没有任何组件，先摆几台机柜再导出');
      return;
    }
    const base = safeFileName(projectName || '未命名工程');
    const file = `${base}-电力统计-${dateStamp()}.csv`;
    downloadTextFile(file, powerReportCsv(stats, projectName), 'text/csv;charset=utf-8');
    toastSuccess(`已导出 ${file}（机房 / 排 / 机柜三级）`);
  };

  /**
   * 截图出图（T3.5 / FR-V07）：2× 分辨率、不含界面。
   * 「不含界面」是天然结果——截的是 WebGL canvas，DOM 面板本就不在其中；
   * 「含界面」需要 DOM 栅格化（另拉依赖），v1 明确不做，已登记为遗留。
   */
  const onExportPng = () => {
    setExportOpen(false);
    const dataUrl = viewportRef.current?.captureImage(2);
    if (!dataUrl) {
      toastError('截图失败：视口尚未就绪或图形上下文不可用，请稍后重试');
      return;
    }
    const base = safeFileName(projectName || '未命名工程');
    const file = `${base}-截图-${dateStamp()}.png`;
    downloadBlob(file, dataUrlToBlob(dataUrl));
    toastSuccess(`已导出 ${file}（2× 分辨率，含近景细节件）`);
  };

  /** 导出工程文件 .archview（FR-I01）：与云端 dataJson 同一形状，文件与服务器可互导 */
  const onExportProject = () => {
    setExportOpen(false);
    const base = safeFileName(projectName || '未命名工程');
    const file = `${base}-${dateStamp()}${ARCHVIEW_EXT}`;
    downloadProjectFile(doc.project, file);
    toastSuccess(`已导出 ${file}`);
  };

  /**
   * 导入工程文件 → 载入当前工程。
   * 两道防护：① 只读工程与未绑定后端的草稿一律拒绝（改了也同步不上去，只会留下一条
   * 永远同步不掉的本地缓冲——正是 §0 批次 A 修掉的那类跨账号污染源头）；
   * ② 文件里一个组件都没有而当前工程有 → 拒绝，防止误清空。
   */
  const onPickProjectFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 不清空则「连续选同一个文件」时第二次不触发 change
    setExportOpen(false);
    if (!file) return;
    if (readOnly) {
      toastError('他人工程为只读，不能载入文件');
      return;
    }
    if (!projectId) {
      toastError('请先从工程列表打开一个工程，再导入文件');
      return;
    }
    const res = await readProjectFile(file);
    if (!res.ok) {
      toastError(`无法打开：${res.error}`);
      return;
    }
    if (res.project.components.length === 0 && doc.project.components.length > 0) {
      toastError('文件里没有任何组件，已拒绝载入（防止误清空当前工程）');
      return;
    }
    useDocumentStore.getState().loadProject(res.project, projectId, serverVersion);
    toastSuccess(`已载入「${res.project.name}」，改动会自动同步到服务器`);
  };

  // 历史快照随 rev 刷新（doc 引用稳定，history getter 无响应性，须用 rev 驱动重算）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const history = useMemo(() => doc.history, [doc, rev]);
  const historyCursor = history.length - history.filter((e) => e.undone).length; // 已执行段长度 = undo 游标

  const saveText = readOnly
    ? '只读'
    : saveStatus === 'saving'
      ? '同步中…'
      : saveStatus === 'dirty'
        ? '未保存'
        : '已保存';
  const saveDot =
    'dot ' +
    (readOnly
      ? 'dot-locked'
      : saveStatus === 'saved'
        ? 'dot-saved'
        : saveStatus === 'saving'
          ? 'dot-saving'
          : 'dot-dirty');

  /**
   * 返回工程列表：先把未保存的改动同步到后端，再跳转。
   * syncNow 内部有 syncing 互斥锁且失败时会写 IndexedDB 缓冲，因此可安全重复调用；
   * 这里 await 是为了让列表页拿到的 updatedAt 是新值（ProjectPage 的卸载兜底不阻塞导航）。
   */
  const goProjects = async () => {
    if (useAppStore.getState().saveStatus !== 'saved') {
      const ok = await syncNow(useAuthStore.getState().accessToken);
      if (ok) toastSuccess('已保存');
      // 被服务端拒绝（无写权限 / 工程已删）时 saveService 已给出具体原因，别重复播报一套假安慰
      else if (!useAppStore.getState().saveBlocked) {
        toastError('同步失败，改动已存入本地缓冲，下次打开该工程时会自动恢复');
      }
    }
    navigate('/');
  };

  /** 菜单里点「工程列表」同样要走保存；去个人中心 / 管理中心由 ProjectPage 卸载时兜底 */
  const onMenuNavigate = (to: string) => {
    if (to === '/') void goProjects();
    else navigate(to);
  };

  return (
    <header className="topbar">
      <button
        className="topbar-back"
        onClick={() => void goProjects()}
        title="返回工程列表（未保存的改动会先同步）"
        aria-label="返回工程列表"
      >
        <Icon name="chevron-left" size={15} />
        <span>工程列表</span>
      </button>

      <span className="topbar-divider" aria-hidden="true" />

      <div className="topbar-brand">
        <BrandMark size={20} strokeWidth={3.2} />
        <span className="topbar-logo-text">ArchView</span>
      </div>

      <button
        className="topbar-project"
        onClick={() => void goProjects()}
        title="当前工程 · 点击返回工程列表（未保存的改动会先同步）"
      >
        {projectName || '未命名工程'}
      </button>

      <span
        className="topbar-save"
        title={
          saveBlocked ??
          (readOnly
            ? '该工程属于其他账号：本账号只读（写权限仅属主），改动不会被保存'
            : '自动保存：每 30s 同步一次 · Ctrl+S 手动保存 · 返回工程列表或关闭页面前也会同步')
        }
      >
        <span className={saveDot} />
        {saveText}
      </span>
      {/* 只读徽标（批次 B）：超管从「查看全部工程」点进他人工程时明示不可写，
          免得用户改了半小时才发现同步不上去（那半小时正是旧的跨账号污染源） */}
      {readOnly && (
        <span className="topbar-readonly">他人工程 · 只读</span>
      )}

      <div className="topbar-tools">
        <button
          className="btn-icon"
          disabled={!canUndo || readOnly}
          onClick={() => useDocumentStore.getState().undo()}
          title={readOnly ? '他人工程为只读，无法撤销' : '撤销（Ctrl+Z）'}
          aria-label="撤销"
        >
          <Icon name="undo" size={15} />
        </button>
        <button
          className="btn-icon"
          disabled={!canRedo || readOnly}
          onClick={() => useDocumentStore.getState().redo()}
          title={readOnly ? '他人工程为只读，无法重做' : '重做（Ctrl+Shift+Z）'}
          aria-label="重做"
        >
          <Icon name="redo" size={15} />
        </button>

        {/* 历史列表（T2.4 / FR-M08「历史列表可查」）：与撤销重做成组，下拉展示全量命令历史 */}
        <span className="topbar-history">
          <button
            className="btn-icon"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={historyOpen}
            title="历史列表（全量命令历史，可查）"
          >
            <Icon name="clock" size={15} />
            <span>历史</span>
          </button>
          {historyOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setHistoryOpen(false)} />
              <div className="menu history-menu" role="menu" aria-label="操作历史">
                <div className="menu-title">操作历史 · {history.length} 条</div>
                {history.length === 0 ? (
                  <div className="menu-item history-empty">暂无操作（放置 / 删除 / 变换都会记录）</div>
                ) : (
                  <ul className="history-list">
                    {history.slice(0, historyCursor).map((e, i) => (
                      <li
                        key={`done-${e.time}-${i}`}
                        className={'history-item' + (i === historyCursor - 1 ? ' current' : '')}
                        title="已执行（可撤销）"
                      >
                        <span className="history-name">{e.name}</span>
                        <span className="history-time">{formatHistoryTime(e.time)}</span>
                      </li>
                    ))}
                    {historyCursor > 0 && historyCursor < history.length && (
                      <li className="history-sep" aria-hidden="true">
                        ↓ 以下 {history.length - historyCursor} 条已撤销（可重做）
                      </li>
                    )}
                    {history.slice(historyCursor).map((e, i) => (
                      <li
                        key={`undone-${e.time}-${i}`}
                        className="history-item undone"
                        title="已撤销（可重做）"
                      >
                        <span className="history-name">{e.name}</span>
                        <span className="history-time">{formatHistoryTime(e.time)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </span>

        <span className="topbar-divider" aria-hidden="true" />

        <div className="seg" role="group" aria-label="视图模式">
          <button
            className={'seg-item' + (viewMode === '3d' ? ' active' : '')}
            aria-pressed={viewMode === '3d'}
            onClick={() => useAppStore.getState().setViewMode('3d')}
          >
            3D
          </button>
          <button
            className={'seg-item' + (viewMode === '2d' ? ' active' : '')}
            aria-pressed={viewMode === '2d'}
            onClick={() => useAppStore.getState().setViewMode('2d')}
          >
            2D
          </button>
        </div>

        <span className="topbar-divider" aria-hidden="true" />

        <button
          className="btn-icon"
          onClick={() => setRoomOpen(true)}
          title="创建房间（弹窗输入尺寸，T2.8）"
        >
          <Icon name="room" size={15} />
          <span>房间</span>
        </button>

        <span className="topbar-divider" aria-hidden="true" />

        {/* 导出与导入（T3.3 / T3.4）：弹层结构与「历史」下拉同一范式（backdrop + .menu） */}
        <span className="topbar-menu">
          <button
            className="btn-icon"
            onClick={() => setExportOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={exportOpen}
            title="导出与导入（统计 CSV / 工程文件 .archview）"
          >
            <Icon name="export" size={15} />
            <span>导出</span>
          </button>
          {exportOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setExportOpen(false)} />
              <div className="menu export-menu" role="menu" aria-label="导出与导入">
                <div className="menu-title">导出与导入</div>
                <button className="menu-item" role="menuitem" onClick={onExportCsv}>
                  电力统计 CSV
                  <span className="menu-hint">机房 / 排 / 机柜三级，Excel 可直接筛选</span>
                </button>
                <button className="menu-item" role="menuitem" onClick={onExportPng}>
                  截图 PNG
                  <span className="menu-hint">2× 分辨率 · 自动升到近景细节档 · 不含界面</span>
                </button>
                <button className="menu-item" role="menuitem" onClick={onExportProject}>
                  工程文件 .archview
                  <span className="menu-hint">备份或换设备继续</span>
                </button>
                <button
                  className="menu-item"
                  role="menuitem"
                  onClick={() => fileInputRef.current?.click()}
                >
                  导入工程文件…
                  <span className="menu-hint">会覆盖当前工程（改动随后自动同步）</span>
                </button>
              </div>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".archview,application/json"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => void onPickProjectFile(e)}
          />
        </span>

        <button
          className="btn-icon"
          onClick={() => useAppStore.getState().setHelpOpen(true)}
          title="快捷键帮助（?）"
          aria-label="快捷键帮助"
        >
          <Icon name="keyboard" size={15} />
          <span>帮助</span>
        </button>
      </div>

      <div className="topbar-actions">
        <button
          className="btn-icon"
          onClick={() => useAppStore.getState().toggleLeft()}
          aria-pressed={leftOpen}
          title="组件库面板（B）"
          aria-label="组件库面板"
        >
          <Icon name={leftOpen ? 'panel-left' : 'panel-left-closed'} size={15} />
        </button>
        <button
          className="btn-icon"
          onClick={() => useAppStore.getState().toggleRight()}
          aria-pressed={rightOpen}
          title="属性 / 统计面板（I）"
          aria-label="属性与统计面板"
        >
          <Icon name={rightOpen ? 'panel-right' : 'panel-right-closed'} size={15} />
        </button>

        <span className="topbar-divider" aria-hidden="true" />

        <UserMenu
          user={user}
          canManageUsers={can(PERMISSIONS.USER_MANAGE)}
          theme={{ dark: themeMode === 'dark', onToggle: toggleTheme }}
          projectsTo="/"
          onNavigate={onMenuNavigate}
          onLogout={() => void logout().then(() => navigate('/login', { replace: true }))}
        />
      </div>

      {/* 房间创建（T2.8） */}
      <RoomDialog open={roomOpen} onClose={() => setRoomOpen(false)} />
    </header>
  );
}
