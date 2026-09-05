import { type FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PERMISSIONS, ROLE_LABELS } from '@archview/core';
import { Icon, type IconName } from '@archview/ui';
import { api } from '../api/client';
import { useAuthStore } from '../auth/useAuthStore';
import { usePermission } from '../auth/usePermission';
import { toastError, toastSuccess } from '../store/useToastStore';
import AppHeader from '../components/AppHeader';
import { useThemeStore } from '../store/useThemeStore';

/** 预设头像（v1 不做上传，FR-U04：avatar 存预设 ID；这里直接用 emoji 作为 ID） */
const AVATARS = ['🦊', '🐼', '🐯', '🐨', '🐰', '🐱', '🐶', '🐧', '🦉', '🐳', '🦄', '🍥'];

type PfTab = 'profile' | 'password' | 'theme';

/**
 * P4 大屏桌面化：三块内容从「760px 窄列纵向堆三张卡」改为
 * 左身份卡（sticky）+ 右页签面板，页面容器放宽到 1680 并撑满可用高度。
 * 原先 2560 屏上内容只占 30% 宽、左右各留 ~900px 空白，是三页里最严重的。
 */
const TABS: { key: PfTab; label: string; icon: IconName }[] = [
  { key: 'profile', label: '基本资料', icon: 'user' },
  { key: 'password', label: '修改密码', icon: 'lock' },
  { key: 'theme', label: '界面偏好', icon: 'palette' },
];

/**
 * 个人中心（FR-U04 / T1.2）：资料（昵称 / 邮箱 / 预设头像）+ 修改密码 + 界面偏好。
 * 首登强制改密（mustChangePassword）：顶部提示 + 自动落在「修改密码」页签；改密成功后放行。
 * 注：AuthUser 不含 createdAt / lastLoginAt（只有管理端的 UserSummary 有），
 * 因此身份卡的元信息用「邮箱 / 我的工程数 / 账号状态」，不硬凑取不到的字段。
 */
export default function ProfilePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [avatar, setAvatar] = useState('');
  const [busy, setBusy] = useState(false);
  /** P4：右侧面板分区（原三张卡纵向堆叠 → 页签） */
  const [tab, setTab] = useState<PfTab>('profile');
  /** P4：身份卡「我的工程」计数——AuthUser 不带该字段，单独取一次列表 */
  const [projectCount, setProjectCount] = useState<number | null>(null);
  const can = usePermission();

  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');

  const themeMode = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);

  const forced =
    (location.state as { force?: boolean } | null)?.force === true || !!user?.mustChangePassword;

  /** 未选 emoji 时的兜底头像字符（预览区与「默认」选项共用，保证两处永远一致） */
  const avatarFallback = (user?.nickname || user?.username || 'U').slice(0, 1).toUpperCase();

  // 表单初值
  useEffect(() => {
    if (!user) return;
    setNickname(user.nickname);
    setEmail(user.email ?? '');
    setAvatar(user.avatar ?? '');
  }, [user]);

  // P4：强制改密时直接落在「修改密码」页签，省掉「看到提示却要找表单」一步
  useEffect(() => {
    if (forced) setTab('password');
  }, [forced]);

  // P4：身份卡的工程计数（失败静默——它只是装饰性信息，不该打扰主流程）
  useEffect(() => {
    if (!token) return;
    let alive = true;
    api
      .projectsList(token)
      .then((list) => alive && setProjectCount(list.length))
      .catch(() => alive && setProjectCount(null));
    return () => {
      alive = false;
    };
  }, [token]);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !user) return;
    if (!nickname.trim()) {
      toastError('昵称不能为空');
      return;
    }
    setBusy(true);
    try {
      const updated = await api.mePatch(
        {
          nickname: nickname.trim(),
          email: email.trim() || undefined,
          avatar: avatar || undefined,
        },
        token,
      );
      setUser(updated);
      toastSuccess('资料已保存');
    } catch (err) {
      toastError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  /**
   * P4：头像选择器搬到了左侧身份卡，与「基本资料」表单不在同一屏，
   * 因此给它一个独立的即时保存入口（仅在选了不同头像时出现），
   * 否则用户在「界面偏好」页签挑了头像却找不到保存按钮。
   */
  const saveAvatar = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const updated = await api.mePatch({ avatar: avatar || undefined }, token);
      setUser(updated);
      toastSuccess('头像已更新');
    } catch (err) {
      toastError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !user) return;
    if (newPwd.length < 6) {
      toastError('新密码至少 6 位');
      return;
    }
    if (newPwd !== confirmPwd) {
      toastError('两次输入的新密码不一致');
      return;
    }
    setBusy(true);
    try {
      const updated = await api.mePassword({ oldPassword: oldPwd, newPassword: newPwd }, token);
      setUser(updated);
      setOldPwd('');
      setNewPwd('');
      setConfirmPwd('');
      toastSuccess('密码已修改');
      // 强制改密完成后回工程列表（除非是从别处进来）
      if (forced) navigate('/', { replace: true });
    } catch (err) {
      toastError(err instanceof Error ? err.message : '修改失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pf-page">
      <AppHeader active="profile" />

      <main className="pf-main">
        {forced && (
          <div className="pf-force-banner">
            首次登录：请修改初始密码后继续（修改后其它设备将下线）
          </div>
        )}

        <div className="pf-layout">
          {/* ---------- 左：身份卡（sticky，大屏下滚动时保持可见） ----------
              AuthUser 没有 createdAt / lastLoginAt，所以元信息只放取得到的三项。 */}
          <aside className="pf-idcard">
            <div className="pf-idcard-hero">
              <span className="avatar avatar-xl">{user?.avatar || avatarFallback}</span>
              <div className="pf-idcard-who">
                <strong className="pf-idcard-name">{user?.nickname || user?.username}</strong>
                <span className="pf-idcard-at">@{user?.username}</span>
              </div>
            </div>

            <div className="pf-idcard-badges">
              <span className="badge badge-pink">{user ? ROLE_LABELS[user.role] : '—'}</span>
              {user?.mustChangePassword && <span className="badge badge-warn">待修改密码</span>}
              {user?.status === 'disabled' && <span className="badge badge-muted">已禁用</span>}
            </div>

            <dl className="pf-meta">
              <div className="pf-meta-row">
                <dt>
                  <Icon name="mail" size={13} />
                  邮箱
                </dt>
                <dd>{user?.email || '未填写'}</dd>
              </div>
              <div className="pf-meta-row">
                <dt>
                  <Icon name="folder" size={13} />
                  我的工程
                </dt>
                <dd>{projectCount === null ? '—' : `${projectCount} 个`}</dd>
              </div>
              <div className="pf-meta-row">
                <dt>
                  <Icon name="shield" size={13} />
                  账号状态
                </dt>
                <dd>{user?.status === 'disabled' ? '已禁用' : '正常'}</dd>
              </div>
            </dl>

            <nav className="pf-idcard-links" aria-label="快捷入口">
              <Link className="pf-idlink" to="/">
                <Icon name="folder" size={14} />
                我的工程
              </Link>
              {can(PERMISSIONS.USER_MANAGE) && (
                <Link className="pf-idlink" to="/admin">
                  <Icon name="shield" size={14} />
                  管理中心
                </Link>
              )}
            </nav>

            <div className="pf-picker">
              <div className="pf-picker-head">
                <span className="pf-picker-label">头像</span>
                {avatar !== (user?.avatar ?? '') && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void saveAvatar()}
                    disabled={busy}
                  >
                    {busy ? '保存中…' : '保存头像'}
                  </button>
                )}
              </div>
              <div className="pf-avatar-grid">
                {/* 首项「默认」= 不选 emoji、用昵称首字。此前未选头像时整个网格没有任何高亮，
                    用户看不出「现在用的是什么」；有了它，选择器恒有且仅有一项选中，
                    也顺带取代原来只在已选头像时才出现的「✕ 清除」按钮。 */}
                <button
                  type="button"
                  className={`pf-avatar-option${avatar === '' ? ' active' : ''}`}
                  onClick={() => setAvatar('')}
                  aria-label="使用默认头像"
                  aria-pressed={avatar === ''}
                  title={'默认头像：' + avatarFallback}
                >
                  {avatarFallback}
                </button>
                {AVATARS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={`pf-avatar-option${avatar === a ? ' active' : ''}`}
                    onClick={() => setAvatar(a)}
                    aria-label={`选择头像 ${a}`}
                    aria-pressed={avatar === a}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          {/* ---------- 右：页签面板（flex 列，撑满剩余宽高） ---------- */}
          <section className={`pf-panel${forced ? ' pf-panel-focus' : ''}`}>
            <div className="pf-tabs" role="tablist" aria-label="个人资料分区">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  id={`pf-tab-${t.key}`}
                  aria-selected={tab === t.key}
                  aria-controls={`pf-panel-${t.key}`}
                  className={`pf-tab${tab === t.key ? ' active' : ''}`}
                  onClick={() => setTab(t.key)}
                >
                  <Icon name={t.icon} size={14} />
                  {t.label}
                  {t.key === 'password' && forced && (
                    <span className="pf-tab-dot" aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>

            <div className="pf-panel-body">
              {tab === 'profile' && (
                <form
                  role="tabpanel"
                  id="pf-panel-profile"
                  aria-labelledby="pf-tab-profile"
                  onSubmit={saveProfile}
                  className="pf-form"
                >
                  <h2 className="pf-section-title">基本资料</h2>
                  <p className="pf-section-desc">
                    昵称与邮箱会出现在页头用户菜单里；头像在左侧身份卡中选择并单独保存。
                  </p>

                  <div className="pf-grid">
                    <label className="field">
                      <span className="field-label">用户名（登录名）</span>
                      <input className="input" value={user?.username ?? ''} disabled />
                    </label>
                    <label className="field">
                      <span className="field-label">昵称</span>
                      <input
                        className="input"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        maxLength={32}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">邮箱</span>
                      <input
                        className="input"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="可选"
                      />
                    </label>
                  </div>
                  <div className="pf-actions">
                    <button className="btn btn-primary" type="submit" disabled={busy}>
                      {busy ? '保存中…' : '保存资料'}
                    </button>
                  </div>
                </form>
              )}

              {tab === 'password' && (
                <form
                  role="tabpanel"
                  id="pf-panel-password"
                  aria-labelledby="pf-tab-password"
                  onSubmit={savePassword}
                  className="pf-form"
                >
                  <h2 className="pf-section-title">修改密码</h2>
                  <p className="pf-section-desc">
                    修改后其它设备的登录态会全部失效，需要重新登录。
                  </p>
                  <div className="pf-grid">
                    <label className="field">
                      <span className="field-label">原密码</span>
                      <input
                        className="input"
                        type="password"
                        value={oldPwd}
                        onChange={(e) => setOldPwd(e.target.value)}
                        autoComplete="current-password"
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">新密码（≥ 6 位）</span>
                      <input
                        className="input"
                        type="password"
                        value={newPwd}
                        onChange={(e) => setNewPwd(e.target.value)}
                        autoComplete="new-password"
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">确认新密码</span>
                      <input
                        className="input"
                        type="password"
                        value={confirmPwd}
                        onChange={(e) => setConfirmPwd(e.target.value)}
                        autoComplete="new-password"
                      />
                    </label>
                  </div>
                  <div className="pf-actions">
                    <button className="btn btn-primary" type="submit" disabled={busy}>
                      {busy ? '提交中…' : '修改密码'}
                    </button>
                  </div>
                </form>
              )}

              {tab === 'theme' && (
                <div
                  role="tabpanel"
                  id="pf-panel-theme"
                  aria-labelledby="pf-tab-theme"
                  className="pf-form"
                >
                  <h2 className="pf-section-title">界面偏好</h2>
                  <p className="pf-section-desc">偏好保存在当前浏览器本地，不影响其它设备。</p>
                  <div className="pf-settings">
                    <div className="pf-setting">
                      <div className="pf-setting-text">
                        <strong>深色界面</strong>
                        <span className="muted">仅切换 UI 配色，3D 视口暂不受影响</span>
                      </div>
                      <div className="pf-setting-act">
                        <span className="badge badge-muted">实验</span>
                        <button
                          className="btn"
                          aria-pressed={themeMode === 'dark'}
                          onClick={() => toggleTheme()}
                        >
                          {themeMode === 'dark' ? '切回浅色' : '切换深色'}
                        </button>
                      </div>
                    </div>
                    {/* 占位行：让「偏好」面板看起来是一个会长大的列表，而不是孤零零一行 */}
                    <div className="pf-setting pf-setting-soon">
                      <div className="pf-setting-text">
                        <strong>界面密度</strong>
                        <span className="muted">紧凑 / 舒适两档，规划中</span>
                      </div>
                      <div className="pf-setting-act">
                        <span className="badge badge-muted">即将上线</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
