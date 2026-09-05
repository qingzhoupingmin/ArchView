import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandMark, Icon, type IconName } from '@archview/ui';
import { api, type UserSummary } from '../api/client';
import { useAuthStore } from '../auth/useAuthStore';
import AuditLogsPanel from '../components/AuditLogsPanel';
import Dialog from '../components/Dialog';
import AppHeader from '../components/AppHeader';
import { toastError, toastSuccess } from '../store/useToastStore';
import { PAGE_SIZE, SIDE_ITEMS, type UserTab } from './admin/adminUtils';
import { UserTable } from './admin/UserTable';
import { ResetPasswordDialog, UserCreateDialog } from './admin/UserFormDialogs';


/**
 * 管理中心（FR-U05 / T1.3，仅超管；系统设置 / 操作日志 P3 接入 T6.7 / T6.8）。
 * 用户列表（搜索 / 角色筛选 / 状态筛选）+ 创建 / 启禁用 / 软删 / 重置密码 / 调角色。
 * P4 大屏桌面化：① 顶部补 KPI 概览条（总用户 / 超管 / 启用 / 禁用），
 * 由已加载列表本地派生，零接口改动；② 表格面板改为 flex 撑满剩余高度 +
 * 表头吸底栏，解决「1 行用户，表格断在半空、下方 80% 空白」；③ 侧栏加图标加宽。
 */
export default function AdminPage() {
  const token = useAuthStore((s) => s.accessToken);
  const me = useAuthStore((s) => s.user);

  const [tab, setTab] = useState<UserTab>('users');
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');

  // 弹窗：新建用户 / 重置密码 / 通用确认
  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserSummary | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    onOk: () => void;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);



  const load = useCallback(async () => {
    if (!token) return;
    try {
      setUsers(await api.usersList(token, { q, role, status }));
    } catch {
      toastError('用户列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [token, q, role, status]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), q ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [load, q]);

  // P1：筛选条件变化回到第一页
  useEffect(() => {
    setPage(1);
  }, [q, role, status]);

  const pageCount = Math.max(1, Math.ceil(users.length / PAGE_SIZE));
  const paged = users.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /**
   * P4：KPI 概览全部由已加载列表本地派生，不额外请求接口。
   * 注意：usersList 目前是全量返回、前端分页，所以这里的计数覆盖全部用户；
   * 若日后接口改为服务端分页，必须换成后端聚合统计，否则数字会只反映当前筛选结果。
   */
  const stats = useMemo(() => {
    let admin = 0;
    let active = 0;
    for (const u of users) {
      if (u.role === 'super_admin') admin += 1;
      if (u.status === 'active') active += 1;
    }
    return { total: users.length, admin, active, disabled: users.length - active };
  }, [users]);

  const statCards: { label: string; value: number; icon: IconName; tone: string }[] = [
    { label: '总用户', value: stats.total, icon: 'users', tone: '' },
    { label: '超级管理员', value: stats.admin, icon: 'shield', tone: ' is-pink' },
    { label: '启用中', value: stats.active, icon: 'check', tone: ' is-ok' },
    { label: '已禁用', value: stats.disabled, icon: 'ban', tone: ' is-warn' },
  ];

  const run = async (fn: () => Promise<void>, okMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toastSuccess(okMsg);
      void load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  /** 新建用户：弹窗只交表单，请求与刷新由页面层的 run() 统一编排（失败提示 / busy / 重载） */
  const onCreateUser = (input: {
    username: string;
    password: string;
    nickname: string;
    role: 'user' | 'super_admin';
  }) => {
    void run(async () => {
      await api.usersCreate(
        {
          username: input.username,
          password: input.password,
          nickname: input.nickname || undefined,
          role: input.role,
        },
        token!,
      );
      setCreateOpen(false);
    }, '用户已创建');
  };

  const onResetPassword = (pwd: string) => {
    if (!resetTarget) return;
    void run(async () => {
      await api.usersResetPassword(resetTarget.id, pwd, token!);
      setResetTarget(null);
    }, '密码已重置（用户下次登录需修改）');
  };

  /**
   * 表格行内动作：UserTable 只报「谁被点了」，是否要二次确认、调哪个接口都在这里。
   * 禁用 / 降级 / 删除对自己的行一律不可点（按钮 disabled 由表格负责），
   * 但重置密码对自己开放——超管忘密时那是唯一自救入口。
   */
  const rowActions = {
    toggleStatus: (u: UserSummary) =>
      void run(
        async () => {
          await api.usersSetStatus(u.id, u.status === 'active' ? 'disabled' : 'active', token!);
        },
        u.status === 'active' ? '已禁用' : '已启用',
      ),
    openReset: (u: UserSummary) => setResetTarget(u),
    toggleRole: (u: UserSummary) =>
      setConfirm({
        title: '调整角色',
        message:
          u.role === 'super_admin'
            ? `将「${u.username}」降级为普通用户？`
            : `将「${u.username}」提升为超级管理员？`,
        onOk: () =>
          void run(async () => {
            await api.usersSetRole(u.id, u.role === 'super_admin' ? 'user' : 'super_admin', token!);
          }, '角色已调整'),
      }),
    remove: (u: UserSummary) =>
      setConfirm({
        title: '删除用户',
        message: `确定删除「${u.username}」吗？（软删除，其工程保留）`,
        onOk: () =>
          void run(async () => {
            await api.usersRemove(u.id, token!);
          }, '已删除'),
      }),
  };

  return (
    <div className="admin-page">
      <AppHeader active="admin" />

      <div className="admin-body">
        <aside className="admin-side">
          <div className="admin-side-head">
            <BrandMark size={20} strokeWidth={3.2} />
            <span>管理中心</span>
          </div>
          <nav className="admin-side-menu" aria-label="管理中心导航">
            {SIDE_ITEMS.map((it) => (
              <button
                key={it.key}
                className={`admin-side-item${tab === it.key ? ' active' : ''}`}
                disabled={!!it.soon}
                title={it.soon ? `${it.label}在 P3 接入` : undefined}
                onClick={() => setTab(it.key)}
              >
                <Icon name={it.icon} size={15} className="admin-side-icon" />
                <span className="admin-side-label">{it.label}</span>
                {it.soon && <span className="admin-soon">{it.soon}</span>}
              </button>
            ))}
          </nav>
          <div className="admin-side-foot">
            <Link to="/">
              <Icon name="chevron-left" size={13} />
              返回工程列表
            </Link>
          </div>
        </aside>

        <main className="admin-main">
          <div className="admin-body-inner">
            {tab === 'users' && (
              <>
                {/* P4 KPI 概览条：超管进页面第一问就是「有多少账号、几个能登录」。
                    数值来自当前已加载列表的本地派生。 */}
                <div className="admin-stats">
                  {statCards.map((s) => (
                    <div key={s.label} className={`admin-stat${s.tone}`}>
                      <span className="admin-stat-icon" aria-hidden="true">
                        <Icon name={s.icon} size={16} />
                      </span>
                      <span className="admin-stat-text">
                        <strong className="admin-stat-value">{loading ? '—' : s.value}</strong>
                        <span className="admin-stat-label">{s.label}</span>
                      </span>
                    </div>
                  ))}
                </div>

                <div className="admin-toolbar">
                  <div className="admin-toolbar-head">
                    <h1 className="admin-title">用户管理</h1>
                    <p className="admin-sub">
                      {loading
                        ? '正在加载…'
                        : `共 ${users.length} 名用户${
                            q || role || status ? '（当前筛选结果）' : ''
                          } · 每页 ${PAGE_SIZE} 条`}
                    </p>
                  </div>
                  <div className="admin-toolbar-actions">
                    <label className="admin-search-wrap">
                      <Icon name="search" size={14} className="admin-search-icon" />
                      <input
                        className="input admin-search"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="搜索用户名 / 昵称…"
                        aria-label="搜索用户名或昵称"
                      />
                    </label>
                    <select
                      className="input admin-select"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      aria-label="按角色筛选"
                    >
                      <option value="">全部角色</option>
                      <option value="super_admin">超级管理员</option>
                      <option value="user">普通用户</option>
                    </select>
                    <select
                      className="input admin-select"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      aria-label="按状态筛选"
                    >
                      <option value="">全部状态</option>
                      <option value="active">启用</option>
                      <option value="disabled">禁用</option>
                    </select>
                    <button
                      className="btn btn-primary admin-create"
                      onClick={() => setCreateOpen(true)}
                    >
                      <Icon name="plus" size={14} />
                      新建用户
                    </button>
                  </div>
                </div>

                {loading ? (
                  <div className="ws-empty ws-empty-loading">
                    <span className="spinner" aria-hidden="true" />
                    <p className="muted">加载中…</p>
                  </div>
                ) : (
                  <UserTable
                    rows={paged}
                    total={users.length}
                    meId={me?.id}
                    busy={busy}
                    page={page}
                    pageCount={pageCount}
                    onPageChange={setPage}
                    hasFilter={!!(q || role || status)}
                    onClearFilters={() => {
                      setQ('');
                      setRole('');
                      setStatus('');
                    }}
                    actions={rowActions}
                  />
                )}
              </>
            )}

            {tab === 'settings' && (
              <div className="admin-placeholder">
                <span className="admin-ph-icon" aria-hidden="true">
                  <Icon name="settings" size={26} />
                </span>
                <h1 className="admin-title">系统设置</h1>
                <p className="muted">
                  站点名称 / Logo、注册模式、默认网格模数（FR-U07，P3 接入 T6.7）
                </p>
                <span className="badge badge-muted">即将上线</span>
              </div>
            )}
            {tab === 'logs' && <AuditLogsPanel token={token ?? ''} />}
          </div>
        </main>
      </div>

      {/* 新建用户（表单状态内聚在弹窗里） */}
      <UserCreateDialog
        open={createOpen}
        busy={busy}
        onClose={() => setCreateOpen(false)}
        onSubmit={onCreateUser}
      />

      {/* 重置密码 */}
      <ResetPasswordDialog
        username={resetTarget?.username ?? null}
        busy={busy}
        onClose={() => setResetTarget(null)}
        onSubmit={onResetPassword}
      />

      {/* 通用确认 */}
      <Dialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        onClose={() => !busy && setConfirm(null)}
        footer={
          <>
            <button className="btn" onClick={() => setConfirm(null)} disabled={busy}>
              取消
            </button>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => {
                confirm?.onOk();
                setConfirm(null);
              }}
            >
              确认
            </button>
          </>
        }
      >
        <p>{confirm?.message}</p>
      </Dialog>
    </div>
  );
}
