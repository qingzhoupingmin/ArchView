/**
 * Toast 渲染（反馈规范 §10.3）：错误顶部、成功底部；点击可提前消失。
 */
import { useToastStore } from '../store/useToastStore';

export default function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const errors = toasts.filter((t) => t.kind === 'error');
  const successes = toasts.filter((t) => t.kind === 'success');
  return (
    <>
      <div className="toast-stack top">
        {errors.map((t) => (
          <div key={t.id} className="toast toast-error" onClick={() => dismiss(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
      <div className="toast-stack bottom">
        {successes.map((t) => (
          <div key={t.id} className="toast toast-success" onClick={() => dismiss(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
