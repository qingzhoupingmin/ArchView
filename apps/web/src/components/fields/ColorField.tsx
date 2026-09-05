import { useEffect, useRef } from 'react';

/**
 * 颜色字段（FR-D01 显示颜色）：value 受控于 doc（实例色 ?? 类型代表色，与渲染层 primColorOf 同优先级；
 * 代表色由 core typeSwatchColor 收口 = 主图元色，避免 web / renderer 两份实现漂移）。
 * 仅在取色器关闭（原生 change）或失焦时提交——拖色不产生逐次历史记录（FR-M08）。
 */
export function ColorField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ value, onCommit });
  latest.current = { value, onCommit };

  // 原生 change：取色对话框关闭时触发一次（React 的 onChange/input 在拖色时连续触发）
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onChange = () => {
      const { value: docValue, onCommit: commit } = latest.current;
      if (el.value && el.value !== docValue) commit(el.value);
    };
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);

  const commitFromBlur = () => {
    const el = inputRef.current;
    if (!el) return;
    const { value: docValue, onCommit: commit } = latest.current;
    if (el.value && el.value !== docValue) commit(el.value);
  };

  return (
    <label className="num-field">
      <span className="num-field-label">{label}</span>
      <input
        ref={inputRef}
        type="color"
        className="insp-color"
        value={value}
        onChange={() => undefined}
        onBlur={commitFromBlur}
      />
      <code className="insp-color-value">{value.toUpperCase()}</code>
    </label>
  );
}
