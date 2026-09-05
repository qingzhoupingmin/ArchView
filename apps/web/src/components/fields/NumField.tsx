import { useEffect, useState } from 'react';

/** 数值字段：失焦 / 回车提交（FR-M03 / M06 精确输入） */
export function NumField({
  label,
  value,
  onCommit,
  step = 1,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
}) {
  const [text, setText] = useState('0');
  useEffect(() => {
    setText(String(Math.round(value * 100) / 100));
  }, [value]);

  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v !== value) onCommit(v);
    else setText(String(Math.round(value * 100) / 100));
  };

  return (
    <label className="num-field">
      <span className="num-field-label">{label}</span>
      <input
        className="input input-sm"
        type="number"
        step={step}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}
