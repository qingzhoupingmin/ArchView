import { type ReactNode, useEffect } from 'react';
import { Icon } from '@archview/ui';
import { registerOverlay, unregisterOverlay } from '../overlays';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** 底部操作区（确认 / 取消按钮等） */
  footer?: ReactNode;
  children: ReactNode;
  /** 宽度（px），默认 420 */
  width?: number;
}

/**
 * 通用弹窗（T1.1~T1.5 共用：新建 / 重命名 / 删除确认 / 重置密码 / 新建用户）。
 * 粉白风格（§10.2）：毛玻璃遮罩 + 白色卡片 + Esc / 遮罩点击关闭。
 */
export default function Dialog({
  open,
  title,
  onClose,
  footer,
  children,
  width = 420,
}: DialogProps) {
  useEffect(() => {
    if (!open) return;
    // T2.7 / §10.3：注册浮层——弹窗打开期间 Esc 只关弹窗、不清空视口选择集（shortcuts.ts 的 Esc 分支查 hasOverlay）
    registerOverlay();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      unregisterOverlay();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="dialog-backdrop" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" style={{ width }}>
        <div className="dialog-head">
          <h3 className="dialog-title">{title}</h3>
          <button className="dialog-close" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </>
  );
}
