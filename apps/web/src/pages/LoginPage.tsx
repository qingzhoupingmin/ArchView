import { FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BrandMark, Icon } from '@archview/ui';
import { ApiError } from '../api/client';
import { useAuthStore } from '../auth/useAuthStore';
import { toastError } from '../store/useToastStore';

/**
 * 注册模式开关（FR-U02 / §10.5）：v1 固定关闭，账号一律由超管在管理中心创建。
 * 产品文档要求「注册」入口仅在注册模式开启时显示，因此关闭态不再渲染灰链接占位
 * （此前用 opacity .5 挂着一个点不动的「注册」，反而诱导点击）。
 * P3 开放自助注册时，把此常量改为读取后端配置即可。
 */
const REGISTRATION_OPEN = false;

function formatLock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? m + ' 分 ' + (s % 60) + ' 秒' : s + ' 秒';
}

/**
 * 登录页（FR-U01 / T1.1 / §10.5）：整页一张浅粉→白渐变，左右两列但不做任何分栏隔断
 * （无竖线、右栏不铺独立底色）——左侧品牌区只留「图形 + 文字 + 线条」：AV 字标、定位语、主标题、
 * 一句描述，加一组纯 CSS 建筑线稿；右侧固定宽度登录卡（毛玻璃）；≤ 1024px 堆叠为单列。
 * 失败统一 toast「用户名或密码错误」防枚举；连续 5 次失败锁定 5 分钟（倒计时，FR-U01）；
 * 路由守卫 redirect 回跳（登录成功回原页面）；首登强制改密跳转个人中心。
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((s) => s.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lockUntil, setLockUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  // 锁定倒计时（FR-U01：连续 5 次失败锁定 5 分钟）
  useEffect(() => {
    if (lockUntil <= Date.now()) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [lockUntil]);

  const lockedMs = lockUntil - now;
  const locked = lockedMs > 0;
  const fieldsMissing = !username || !password;
  // P3：按钮进入禁用态时给出原因——此前只是灰掉（且灰到看不清字），用户不知道为何不能点
  const btnHint = locked
    ? `连续失败次数过多，请 ${formatLock(lockedMs)} 后再试`
    : fieldsMissing
      ? '请先填写用户名和密码'
      : undefined;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading || locked) return;
    setLoading(true);
    try {
      const user = await login(username.trim(), password);
      // 首登强制改密（FR-U02：超管新建的用户 / 被重置密码的用户 → 个人中心）
      if (user.mustChangePassword) {
        navigate('/profile', { replace: true, state: { force: true } });
        return;
      }
      // redirect 回跳（路由守卫携带的 from 参数，T1.1）
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'LOGIN_LOCKED') {
        const retryAfter = Number(err.detail?.retryAfter ?? 300);
        setLockUntil(Date.now() + retryAfter * 1000);
        setNow(Date.now());
        return;
      }
      toastError(err instanceof ApiError ? err.message : '网络异常，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* 背景柔光斑：唯一的背景装饰，给毛玻璃卡片提供可被模糊的底纹 */}
      <span className="login-glow login-glow-1" aria-hidden="true" />
      <span className="login-glow login-glow-2" aria-hidden="true" />

      {/* 左侧 · 品牌区：AV 字标 + 文字 + 线稿，不摆具体功能清单；与右栏共用同一张渐变底 */}
      <section className="login-hero">
        <div className="login-brand">
          <div className="login-logo">
            <BrandMark size={30} />
            <span>ArchView</span>
          </div>
          <p className="login-brand-tag">建筑与室内设计 · 三维建模与数字孪生平台</p>
        </div>

        <div className="login-hero-body">
          <h1 className="login-hero-title">
            在浏览器里，<em>把空间画成三维</em>
          </h1>
          <p className="login-hero-desc">
            拖放建模 · 属性联动 · 实时统计 · 一键导出：从概念方案到交付，一个工具跟到底。
          </p>
        </div>

        {/* 线稿装饰：一条地平线 + 高矮不一的竖线 + 一条主色「选中」线，与建模视口的
            地平线 / 体量轮廓同源（取 --vp-* token），纯 CSS 绘制、零图形资源。
            子元素顺序对应 login.css 的 nth-child 高度规则，增删需同步。 */}
        <div className="login-lines" aria-hidden="true">
          <span className="login-line-bar" />
          <span className="login-line-bar" />
          <span className="login-line-bar" />
          <span className="login-line-bar login-line-bar-accent" />
          <span className="login-line-bar" />
        </div>

        <div className="login-brand-foot">
          © 2026 ArchView · 开源建筑与室内设计三维建模 · v{__APP_VERSION__}
        </div>
      </section>

      {/* 右侧 · 登录区：与品牌区共用同一张渐变底，无分隔线、无独立底色 */}
      <section className="login-panel">
        <div className="login-card">
          <h2 className="login-title">欢迎回来</h2>
          <p className="login-sub">登录 ArchView，继续你的设计</p>

          <form onSubmit={submit}>
            <label className="field">
              <span className="field-label">用户名</span>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                autoComplete="username"
                autoFocus
              />
            </label>
            <label className="field">
              <span className="field-label">密码</span>
              <div className="pwd-wrap">
                <input
                  className="input"
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="pwd-toggle"
                  onClick={() => setShowPwd((v) => !v)}
                  aria-label={showPwd ? '隐藏密码' : '显示密码'}
                  title={showPwd ? '隐藏密码' : '显示密码'}
                >
                  <Icon name={showPwd ? 'eye-off' : 'eye'} size={16} />
                </button>
              </div>
            </label>
            {locked && (
              <p className="login-locked">连续失败次数过多，请 {formatLock(lockedMs)} 后再试</p>
            )}
            <button
              type="submit"
              className="btn btn-login"
              disabled={loading || locked || fieldsMissing}
              title={btnHint}
            >
              {loading ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  登录中…
                </>
              ) : locked ? (
                '已锁定（' + formatLock(lockedMs) + '）'
              ) : (
                '登 录'
              )}
            </button>
          </form>

          <div className="login-footer">
            <span>账号由超管创建</span>
            {REGISTRATION_OPEN && (
              // §10.5：注册模式开启才显示入口；P3 开放自助注册时改为 <Link to="/register">
              <span className="login-reg-link">注册</span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
