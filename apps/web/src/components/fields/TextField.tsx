import { useEffect, useState } from 'react';

/** 文本字段：失焦 / 回车提交 */
export function TextField({
  label,
  value,
  onCommit,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);

  const commit = () => {
    const v = text.trim();
    if (v !== value) onCommit(v);
    else setText(value);
  };

  return (
    <label className="num-field">
      <span className="num-field-label">{label}</span>
      <input
        className="input input-sm"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}
