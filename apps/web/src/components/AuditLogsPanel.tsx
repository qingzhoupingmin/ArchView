import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@archview/ui';
import { api, type AuditItem } from '../api/client';
import { toastError } from '../store/useToastStore';

/** 每页条数（与用户列表同口径，避免超管一次拉穿日志表） */
const PAGE_SIZE = 50;

/** 动作筛选项：与后端 AUDIT 常量对齐；「读他人工程」单列出来，它是隔离审计最该盯的一条 */
const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '全部动作' },
  { value: 'login', label: '登录成功' },
  { value: 'login.fail', label: '登录失败' },
  { value: 'login.locked', label: '触发锁定' },
  { value: 'logout', label: '登出' },
  { value: 'project.create', label: '工程创建' },
  { value: 'project.read_foreign', label: '读他人工程' },
  { value: 'project.update', label: '工程保存' },
  { value: 'project.delete', label: '工程删除' },
  { value: 'project.conflict', label: '保存冲突' },
  { value: 'user.create', label: '创建用户' },
  { value: 'user.status', label: '启禁用用户' },
  { value: 'user.role', label: '调整角色' },
  { value: 'user.reset_password', label: '重置密码' },
  { value: 'user.delete', label: '删除用户（软删）' },
  { value: 'user.purge', label: '彻底删除用户' },
];

const ACTION_LABEL = new Map(ACTION_OPTIONS.map((a) => [a.value, a.label]));

/** 需要醒目（暖色徽章）的动作：越权读与爆破失败 */
const HOT_ACTIONS = new Set(['project.read_foreign', 'login.fail', 'login.locked', 'user.purge']);

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 操作日志面板（FR-U09 · 数据隔离专项批次 D）。
 *
 * 为什么这次就做：产品文档把它排在 P3，但隔离整改若没有「谁读过 / 改过谁的工程」的留痕，
 * 一旦出现串号就只能靠猜。核心视图是 project.read_foreign —— 超管读他人工程每次都留痕。
 */
export default function AuditLogsPanel({ token }: { token: string }) {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);
  /** 展开看 detail 原文的行 id（detail 是 JSON 串，默认不铺开） */
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const page = await api.auditList(token, {
        action: action || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setItems(page.items);
      setTotal(page.total);
    } catch (err) {
      toastError(err instanceof Error ? err.message : '操作日志加载失败');
    } finally {
      setLoading(false);
    }
  }, [token, action, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (loading) {
    return (
      <div className="ws-empty ws-empty-loading">
        <span className="spinner" aria-hidden="true" />
        <p className="muted">加载中…</p>
      </div>
    );
  }

  return (
    <section className="admin-logs" aria-label="操作日志">
      <div className="admin-toolbar">
        <div className="admin-toolbar-head">
          <h1 className="admin-title">操作日志</h1>
          <p className="admin-sub">
            {`共 ${total} 条 · 每页 ${PAGE_SIZE} 条 · 超管读他人工程（project.read_foreign）会单独留痕`}
          </p>
        </div>
        <div className="admin-toolbar-actions">
          <select
            className="input admin-select"
            aria-label="按动作筛选"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setOffset(0);
            }}
          >
            {ACTION_OPTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" onClick={() => void load()} title="重新拉取">
            <Icon name="sync" size={14} />
            刷新
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="muted">
          暂无匹配日志。登录、工程读写、用户变更都会自动留痕（FR-U09）。
        </p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>动作</th>
                  <th>操作人</th>
                  <th>目标</th>
                  <th>来源 IP</th>
                  <th className="th-actions">详情</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="muted">{formatTime(it.createdAt)}</td>
                    <td>
                      <span className={`badge ${HOT_ACTIONS.has(it.action) ? 'badge-warn' : 'badge-muted'}`}>
                        {ACTION_LABEL.get(it.action) ?? it.action}
                      </span>
                    </td>
                    <td>{it.userId ?? <span className="muted">（未登录）</span>}</td>
                    <td className="muted">{it.target ?? '—'}</td>
                    <td className="muted">{it.ip ?? '—'}</td>
                    <td className="td-actions">
                      <button
                        className="row-act"
                        onClick={() => setExpanded(expanded === it.id ? null : it.id)}
                        title={expanded === it.id ? '收起' : '展开完整详情'}
                      >
                        {expanded === it.id ? '收起' : '查看'}
                      </button>
                      {expanded === it.id && <pre className="admin-log-detail">{it.detail ?? '—'}</pre>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span>{`共 ${total} 条 · 每页 ${PAGE_SIZE} 条`}</span>
            <span className="pager">
              <button
                className="btn btn-sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                上一页
              </button>
              <span className="pager-info">{page + ' / ' + pages}</span>
              <button
                className="btn btn-sm"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                下一页
              </button>
            </span>
          </div>
        </>
      )}
    </section>
  );
}
