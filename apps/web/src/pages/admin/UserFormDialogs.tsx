import { type FormEvent, useState } from 'react';
import { toastError } from '../../store/useToastStore';
import Dialog from '../../components/Dialog';

interface CreateForm {
  username: string;
  password: string;
  nickname: string;
  role: 'user' | 'super_admin';
}

/** 新建用户表单初值（提到模块级，关闭弹窗后重开必定是干净状态） */
const EMPTY_FORM: CreateForm = { username: '', password: '', nickname: '', role: 'user' };

export interface NewUserInput {
  username: string;
  password: string;
  nickname: string;
  role: 'user' | 'super_admin';
}

interface CreateProps {
  open: boolean;
  /** 请求进行中：禁用关闭与重复提交（避免连点建出两个同名账号） */
  busy: boolean;
  onClose(): void;
  onSubmit(input: NewUserInput): void;
}

/** 新建用户弹窗（管理中心拆分 Phase 6）：表单状态内聚，校验文案沿用原文 */
export function UserCreateDialog({ open, busy, onClose, onSubmit }: CreateProps) {
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.username.trim() || form.password.length < 6) {
      toastError('用户名至少 2 位，密码至少 6 位');
      return;
    }
    onSubmit({
      username: form.username.trim(),
      password: form.password,
      nickname: form.nickname.trim(),
      role: form.role,
    });
    setForm(EMPTY_FORM);
  };

  return (
    <Dialog
      open={open}
      title="新建用户"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            className="btn btn-primary"
            type="submit"
            form="admin-create-form"
            disabled={busy}
          >
            {busy ? '创建中…' : '创建'}
          </button>
        </>
      }
    >
      <form id="admin-create-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">用户名（登录名）</span>
          <input
            className="input"
            value={form.username}
            onChange={(e) => setForm((s) => ({ ...s, username: e.target.value }))}
            placeholder="2-32 位小写字母 / 数字 / _"
            minLength={2}
            maxLength={32}
            autoFocus
          />
        </label>
        <label className="field">
          <span className="field-label">初始密码（≥ 6 位）</span>
          <input
            className="input"
            type="password"
            value={form.password}
            onChange={(e) => setForm((s) => ({ ...s, password: e.target.value }))}
            minLength={6}
            maxLength={128}
          />
        </label>
        <label className="field">
          <span className="field-label">昵称（可选）</span>
          <input
            className="input"
            value={form.nickname}
            onChange={(e) => setForm((s) => ({ ...s, nickname: e.target.value }))}
            maxLength={32}
          />
        </label>
        <label className="field">
          <span className="field-label">角色</span>
          <select
            className="input"
            value={form.role}
            onChange={(e) => setForm((s) => ({ ...s, role: e.target.value as 'user' | 'super_admin' }))}
          >
            <option value="user">普通用户</option>
            <option value="super_admin">超级管理员</option>
          </select>
        </label>
      </form>
    </Dialog>
  );
}

interface ResetProps {
  /** 目标用户名，null = 关闭 */
  username: string | null;
  busy: boolean;
  onClose(): void;
  onSubmit(password: string): void;
}

/** 重置密码弹窗（管理中心拆分 Phase 6）：只在关闭时清输入，避免提交失败后白填 */
export function ResetPasswordDialog({ username, busy, onClose, onSubmit }: ResetProps) {
  const [pwd, setPwd] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pwd.length < 6) {
      toastError('新密码至少 6 位');
      return;
    }
    onSubmit(pwd);
    setPwd('');
  };

  return (
    <Dialog
      open={username !== null}
      title={`重置密码 · ${username ?? ''}`}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            className="btn btn-primary"
            type="submit"
            form="admin-reset-form"
            disabled={busy}
          >
            {busy ? '重置中…' : '确认重置'}
          </button>
        </>
      }
    >
      <form id="admin-reset-form" onSubmit={submit}>
        <p className="muted">重置后该用户其它设备将下线，且下次登录需修改密码。</p>
        <label className="field">
          <span className="field-label">新密码（≥ 6 位）</span>
          <input
            className="input"
            type="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            minLength={6}
            maxLength={128}
            autoFocus
          />
        </label>
      </form>
    </Dialog>
  );
}
