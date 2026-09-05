import { ROLE_LABELS } from '@archview/core';
import { Icon } from '@archview/ui';
import type { UserSummary } from '../../api/client';
import { PAGE_SIZE, formatTime } from './adminUtils';

/** 行内动作：确认弹窗与请求编排都留在页面层，本组件只负责「谁被点了」 */
export interface UserRowActions {
  toggleStatus(u: UserSummary): void;
  openReset(u: UserSummary): void;
  toggleRole(u: UserSummary): void;
  remove(u: UserSummary): void;
}

interface Props {
  rows: UserSummary[];
  total: number;
  /** 当前登录者 id：自己的行要禁掉禁用 / 降级 / 删除（避免把自己锁在门外） */
  meId: string | undefined;
  busy: boolean;
  page: number;
  pageCount: number;
  onPageChange(page: number): void;
  /** 空结果时的「清空筛选」——三个筛选条件由页面层持有 */
  hasFilter: boolean;
  onClearFilters(): void;
  actions: UserRowActions;
}

/**
 * 用户表格（管理中心拆分 Phase 6）：列表 + 空态 + 分页底栏。
 *
 * P4 的两条布局约定都写在这里，别退回旧写法：
 * ① 空结果提示绝对居中在表格留白区（桌面表格控件的空态惯例），不再在底栏下挂一行小灰字；
 * ② 底栏移出滚动容器，靠 margin-top:auto 沉到面板底部——解决「1 行用户时表格断在半空、
 *    下方 80% 空白」。
 */
export function UserTable({
  rows,
  total,
  meId,
  busy,
  page,
  pageCount,
  onPageChange,
  hasFilter,
  onClearFilters,
  actions,
}: Props) {
  return (
    <>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>用户名</th>
              <th>昵称</th>
              <th>角色</th>
              <th>状态</th>
              <th>最近登录</th>
              <th>创建时间</th>
              <th className="th-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className={u.status === 'disabled' ? 'row-disabled' : ''}>
                <td>
                  <span className="avatar avatar-xs">
                    {u.avatar || u.username.slice(0, 1).toUpperCase()}
                  </span>
                  {u.username}
                  {u.id === meId && <span className="badge badge-muted">（我）</span>}
                </td>
                <td>{u.nickname}</td>
                <td>
                  <span
                    className={`badge ${u.role === 'super_admin' ? 'badge-pink' : 'badge-muted'}`}
                  >
                    {ROLE_LABELS[u.role]}
                  </span>
                </td>
                <td>
                  <span className={`badge ${u.status === 'active' ? 'badge-ok' : 'badge-warn'}`}>
                    {u.status === 'active' ? '启用' : '禁用'}
                  </span>
                </td>
                <td className="muted">{formatTime(u.lastLoginAt)}</td>
                <td className="muted">{formatTime(u.createdAt)}</td>
                <td className="td-actions">
                  <button
                    className="row-act"
                    disabled={busy || u.id === meId}
                    onClick={() => actions.toggleStatus(u)}
                    title={
                      u.id === meId
                        ? '不能对当前登录账号执行此操作'
                        : u.status === 'active'
                          ? '禁用该账号'
                          : '启用该账号'
                    }
                  >
                    {u.status === 'active' ? '禁用' : '启用'}
                  </button>
                  <button
                    className="row-act"
                    disabled={busy}
                    // 对自己仍开放（超管忘密时是唯一自救入口），但明确警告后果，
                    // 避免误点后突然被强制改密却不知道为什么（P3 一致性说明）
                    title={
                      u.id === meId
                        ? '重置自己的密码：其它设备将下线，且下次登录需改密（日常改密请走个人中心）'
                        : '重置该账号密码：其它设备下线，下次登录须改密'
                    }
                    onClick={() => actions.openReset(u)}
                  >
                    重置密码
                  </button>
                  <button
                    className="row-act"
                    disabled={busy || u.id === meId}
                    onClick={() => actions.toggleRole(u)}
                    title={
                      u.id === meId
                        ? '不能对当前登录账号调整角色'
                        : '调整该账号的管理员角色'
                    }
                  >
                    {u.role === 'super_admin' ? '降级' : '提升'}
                  </button>
                  <button
                    className="row-act row-act-danger"
                    disabled={busy || u.id === meId}
                    title={u.id === meId ? '不能删除当前登录账号' : '删除该账号（软删除）'}
                    onClick={() => actions.remove(u)}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="admin-no-match">
            <Icon name="users" size={22} />
            <p className="muted">没有匹配的用户，换个关键词或清空筛选试试</p>
            {hasFilter && (
              <button className="btn btn-sm" onClick={onClearFilters}>
                清空筛选
              </button>
            )}
          </div>
        )}
      </div>
      <div className="table-foot">
        <span>{'共 ' + total + ' 名用户 · 每页 ' + PAGE_SIZE + ' 条'}</span>
        <span className="pager">
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            上一页
          </button>
          <span className="pager-info">{page + ' / ' + pageCount}</span>
          <button
            className="btn btn-sm"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            下一页
          </button>
        </span>
      </div>
    </>
  );
}
