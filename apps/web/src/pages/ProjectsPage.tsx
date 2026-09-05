import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useMemo,
  useState,
  useEffect,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@archview/ui';
import { api, type ProjectSummary } from '../api/client';
import { useAuthStore } from '../auth/useAuthStore';
import AppHeader from '../components/AppHeader';
import Dialog from '../components/Dialog';
import { idbClearBuffer } from '../save/saveService';
import { toastError, toastSuccess } from '../store/useToastStore';

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    '-' +
    p(d.getMonth() + 1) +
    '-' +
    p(d.getDate()) +
    ' ' +
    p(d.getHours()) +
    ':' +
    p(d.getMinutes())
  );
}

type SortKey = 'updated' | 'created' | 'name';

/** 他人工程的统一提示（批次 B / S3：写权限仅属主，超管也只能读） */
const READONLY_HINT = '该工程属于其他账号：写权限仅属主（超管可读不可写）';

/**
 * 工程列表 / 工作台（T1.5）：登录后首页。
 * 新建 → 后端创建 → 进入 /project/:id；打开 / 重命名 / 删除（确认弹窗）。
 * P1 布局优化：应用页头改用共用的 AppHeader；列表从单列长条改为响应式卡片网格，
 * 支持排序 / 键盘打开（Enter、Space）/ 空态主行动点。
 * P4 大屏桌面化：① 工具栏升级为页头条（标题 + 环境统计 + 搜索 / 排序 / 新建三列），
 * 主操作从全局页头下移到内容区，符合桌面软件「动作贴着内容」的习惯；
 * ② 卡片补封面区与创建时间，解决 2560 屏下「一个空盒子挂在左上」；
 * ③ 底部提示从居中虚线一行升级为三张指南卡并沉底，吃掉下半屏真空。
 * 统计（工程数 / 最近更新）全部由已加载的 projects 本地派生，不额外请求接口。
 */
export default function ProjectsPage() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.accessToken);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');

  // 弹窗状态
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ProjectSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setProjects(await api.projectsList(token));
    } catch {
      toastError('工程列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const list = kw ? projects.filter((p) => p.name.toLowerCase().includes(kw)) : projects.slice();
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    else if (sort === 'created') list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return list;
  }, [projects, keyword, sort]);

  /** 是否含他人工程（超管凭 project:view-all 看全部）：标题据此从「我的工程」切成「全部工程」 */
  const viewingAll = useMemo(() => projects.some((p) => !p.canEdit), [projects]);

  /** P4：页头条的环境统计——全部工程里最晚的一次更新时间 */
  const lastUpdated = useMemo(() => {
    if (projects.length === 0) return '';
    return projects.reduce(
      (max, p) => (p.updatedAt > max ? p.updatedAt : max),
      projects[0].updatedAt,
    );
  }, [projects]);

  const doCreate = async (e: FormEvent) => {
    e.preventDefault();
    const name = nameInput.trim();
    if (!name || !token) return;
    setBusy(true);
    try {
      const p = await api.projectsCreate({ name }, token);
      toastSuccess('已创建工程：' + name);
      setCreateOpen(false);
      navigate('/project/' + p.id);
    } catch (err) {
      toastError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setBusy(false);
    }
  };

  const doRename = async (e: FormEvent) => {
    e.preventDefault();
    const name = nameInput.trim();
    if (!name || !renameTarget || !token) return;
    if (!renameTarget.canEdit) {
      toastError(READONLY_HINT);
      return;
    }
    setBusy(true);
    try {
      await api.projectsUpdate(renameTarget.id, { name }, token);
      toastSuccess('已重命名');
      setRenameTarget(null);
      void load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : '重命名失败');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget || !token) return;
    if (!deleteTarget.canEdit) {
      toastError(READONLY_HINT);
      return;
    }
    const name = deleteTarget.name;
    const id = deleteTarget.id;
    setBusy(true);
    try {
      await api.projectsRemove(id, token);
      toastSuccess('已删除工程：' + name);
      // 顺手回收该工程的本地缓冲：否则已删工程的内容会永久留在浏览器里
      // （占空间 + 隐私残留；批次 A 收尾）
      void idbClearBuffer(id);
      setDeleteTarget(null);
      void load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  const open = (id: string) => navigate('/project/' + id);
  const onRowKey = (e: KeyboardEvent<HTMLLIElement>, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open(id);
    }
  };

  const openCreate = () => {
    setNameInput('');
    setCreateOpen(true);
  };

  return (
    <div className="ws-page">
      <AppHeader active="projects" />

      <main className="ws-main">
        {/* P4 页头条：左「标题 + 环境统计」，右「搜索 / 排序 / 主操作」。
            新建按钮从全局页头下移到这里——桌面软件的动作应贴着它作用的内容区。 */}
        <header className="ws-hero">
          <div className="ws-hero-head">
            <h1 className="ws-title">{viewingAll ? '全部工程' : '我的工程'}</h1>
            <p className="ws-hero-sub">
              <span>{loading ? '正在加载…' : `共 ${projects.length} 个工程`}</span>
              {!loading && lastUpdated && (
                <>
                  <span className="ws-hero-sep" aria-hidden="true" />
                  <Icon name="clock" size={13} />
                  <span>最近更新 {formatTime(lastUpdated)}</span>
                </>
              )}
              {!loading && keyword.trim() && (
                <>
                  <span className="ws-hero-sep" aria-hidden="true" />
                  <span>匹配 {visible.length} 个</span>
                </>
              )}
            </p>
          </div>

          <div className="ws-hero-tools">
            <label className="ws-search-wrap">
              <Icon name="search" size={14} className="ws-search-icon" />
              <input
                className="input ws-search"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索工程名称…"
                aria-label="搜索工程名称"
              />
            </label>
            <select
              className="input ws-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="排序方式"
            >
              <option value="updated">最近更新</option>
              <option value="created">最近创建</option>
              <option value="name">名称 A→Z</option>
            </select>
            <button className="btn btn-primary ws-create" onClick={openCreate}>
              <Icon name="plus" size={14} />
              新建工程
            </button>
          </div>
        </header>

        {loading ? (
          <div className="ws-empty ws-empty-loading">
            <span className="spinner" aria-hidden="true" />
            <p className="muted">加载中…</p>
          </div>
        ) : visible.length === 0 ? (
          /* P4：空态从「居中一坨文字」改为左右分栏——左侧说明与行动点，右侧纯 CSS 平面线稿，
             大屏下不再是一个小孤岛漂在整屏空白里 */
          <section className="ws-empty">
            <div className="ws-empty-copy">
              <div className="ws-empty-icon" aria-hidden="true">
                <Icon name="cube" size={28} />
              </div>
              <h2 className="ws-empty-title">{keyword ? '没有匹配的工程' : '还没有工程'}</h2>
              <p className="ws-empty-desc">
                {keyword
                  ? '换个关键词试试，或清空搜索看全部工程。'
                  : '新建一个工程，把想法直接画成三维模型：放置机柜与隔墙，实时看电力和面积统计。'}
              </p>
              <div className="ws-empty-actions">
                {!keyword && (
                  <button className="btn btn-primary" onClick={openCreate}>
                    <Icon name="plus" size={14} />
                    新建工程
                  </button>
                )}
                <button className="btn" onClick={() => navigate('/profile')}>
                  完善个人资料
                </button>
              </div>
            </div>
            {/* 平面线稿（纯装饰）：一条地平线 + 标高虚线 + 楼层线 + 八根不等高竖线，
                其中第 4 根取 --vp-selection 作选中态，与登录页 .login-lines 同源。
                子元素顺序对应 pages.css 的 nth-child 高度规则，增删需同步。 */}
            <div className="ws-empty-art" aria-hidden="true">
              <span className="ws-empty-art-bar" />
              <span className="ws-empty-art-bar" />
              <span className="ws-empty-art-bar" />
              <span className="ws-empty-art-bar ws-empty-art-bar-accent" />
              <span className="ws-empty-art-bar" />
              <span className="ws-empty-art-bar" />
              <span className="ws-empty-art-bar" />
              <span className="ws-empty-art-bar" />
            </div>
          </section>
        ) : (
          <ul className="ws-list">
            {visible.map((p) => (
              <li
                key={p.id}
                className="ws-item"
                role="button"
                tabIndex={0}
                aria-label={'打开工程：' + p.name}
                onClick={() => open(p.id)}
                onKeyDown={(e) => onRowKey(e, p.id)}
              >
                {/* P4 封面区：ProjectSummary 里没有缩略图与组件数字段，先用品牌渐变 +
                    立方体线稿占位，把卡片的视觉重量撑起来（原先 272×130 的空盒感就来自这里）。
                    真缩略图需后端存图，属另立项，本次不动接口。 */}
                <div className="ws-item-cover" aria-hidden="true">
                  <Icon name="cube" size={34} className="ws-item-cover-art" />
                  <span className="badge badge-pink ws-item-tag">数据中心</span>
                </div>
                <div className="ws-item-body">
                  <div className="ws-item-name">{p.name}</div>
                  <div className="ws-item-meta">
                    <Icon name="clock" size={12} />
                    <span>更新于 {formatTime(p.updatedAt)}</span>
                    {/* 归属（批次 B / S3）：超管「查看全部工程」时必须看得出这是谁的，
                        否则几十个同名卡片分不清，行内操作又必然 404 —— 旧版「数据串了」的观感来源 */}
                    {!p.canEdit && (
                      <span className="badge badge-muted ws-item-owner">
                        {p.ownerDeleted ? `无主（${p.ownerName} 已删除）` : `${p.ownerName} 的工程`}
                      </span>
                    )}
                  </div>
                </div>
                <div className="ws-item-foot">
                  <span className="ws-item-since">创建于 {formatTime(p.createdAt)}</span>
                  {/* stopPropagation 只挂在按钮容器上：整条 foot 都拦的话，
                      点卡片下半部分会变成「点了打不开」的死区 */}
                  <span className="ws-item-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="row-act" onClick={() => open(p.id)}>
                      {p.canEdit ? '打开' : '只读查看'}
                    </button>
                    <button
                      className="row-act"
                      disabled={!p.canEdit}
                      title={p.canEdit ? '重命名' : READONLY_HINT}
                      onClick={() => {
                        if (!p.canEdit) return;
                        setNameInput(p.name);
                        setRenameTarget(p);
                      }}
                    >
                      重命名
                    </button>
                    <button
                      className="row-act row-act-danger"
                      disabled={!p.canEdit}
                      title={p.canEdit ? '删除' : READONLY_HINT}
                      onClick={() => {
                        if (!p.canEdit) return;
                        setDeleteTarget(p);
                      }}
                    >
                      删除
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* P4：上手提示从「居中虚线一行行」升级为三张指南卡，并靠 margin-top:auto 沉底，
            吃掉工程数少时下半屏的真空（P3 只是把提示常驻，没解决版面空洞） */}
        {!loading && visible.length > 0 && (
          <section className="ws-guide" aria-label="进工程前先知道">
            <article className="ws-guide-card">
              <h2 className="ws-guide-head">
                <span className="ws-guide-icon" aria-hidden="true">
                  <Icon name="keyboard" size={16} />
                </span>
                快捷键
              </h2>
              <ul className="ws-guide-list">
                <li>
                  <kbd>B</kbd> 收起组件库面板
                </li>
                <li>
                  <kbd>I</kbd> 开关属性面板
                </li>
                <li>
                  <kbd>G</kbd> 网格吸附
                </li>
                <li>
                  <kbd>Delete</kbd> 删除选中组件
                </li>
              </ul>
            </article>

            <article className="ws-guide-card">
              <h2 className="ws-guide-head">
                <span className="ws-guide-icon" aria-hidden="true">
                  <Icon name="sync" size={16} />
                </span>
                自动保存
              </h2>
              <ul className="ws-guide-list">
                <li>每 30s 同步一次到服务端</li>
                <li>关闭页面前会再保存一次</li>
                <li>
                  <kbd>Ctrl</kbd> + <kbd>S</kbd> 随时手动同步
                </li>
              </ul>
            </article>

            <article className="ws-guide-card">
              <h2 className="ws-guide-head">
                <span className="ws-guide-icon" aria-hidden="true">
                  <Icon name="layers" size={16} />
                </span>
                模块规划
              </h2>
              <ul className="ws-guide-list">
                <li>
                  <span className="badge badge-pink">数据中心</span> 机柜布置与电力统计已可用
                </li>
                <li>
                  <span className="badge badge-muted">建筑空间</span> 规划中
                </li>
                <li>
                  <span className="badge badge-muted">室内软装</span> 规划中
                </li>
              </ul>
            </article>
          </section>
        )}
      </main>

      {/* 新建工程 */}
      <Dialog
        open={createOpen}
        title="新建工程"
        onClose={() => !busy && setCreateOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setCreateOpen(false)} disabled={busy}>
              取消
            </button>
            <button className="btn btn-primary" type="submit" form="ws-create-form" disabled={busy}>
              {busy ? '创建中…' : '创建并打开'}
            </button>
          </>
        }
      >
        <form id="ws-create-form" onSubmit={doCreate}>
          <label className="field">
            <span className="field-label">工程名称</span>
            <input
              className="input"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="例如：滨江中心 A 栋 · 样板间方案"
              maxLength={100}
              autoFocus
            />
          </label>
          <p className="muted">创建后进入建模界面，从左侧组件库放置第一个组件。</p>
        </form>
      </Dialog>

      {/* 重命名 */}
      <Dialog
        open={renameTarget !== null}
        title="重命名工程"
        onClose={() => !busy && setRenameTarget(null)}
        footer={
          <>
            <button className="btn" onClick={() => setRenameTarget(null)} disabled={busy}>
              取消
            </button>
            <button className="btn btn-primary" type="submit" form="ws-rename-form" disabled={busy}>
              {busy ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        <form id="ws-rename-form" onSubmit={doRename}>
          <label className="field">
            <span className="field-label">工程名称</span>
            <input
              className="input"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={100}
              autoFocus
            />
          </label>
        </form>
      </Dialog>

      {/* 删除确认 */}
      <Dialog
        open={deleteTarget !== null}
        title="删除工程"
        onClose={() => !busy && setDeleteTarget(null)}
        footer={
          <>
            <button className="btn" onClick={() => setDeleteTarget(null)} disabled={busy}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void doDelete()} disabled={busy}>
              {busy ? '删除中…' : '确认删除'}
            </button>
          </>
        }
      >
        <p>
          确定删除工程「<strong>{deleteTarget?.name}</strong>」吗？删除后不可恢复。
        </p>
      </Dialog>
    </div>
  );
}
