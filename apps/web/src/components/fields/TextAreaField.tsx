import { useEffect, useState } from 'react';

/** 文本域字段：失焦 / Enter 提交（Shift+Enter 换行）（FR-D05 长文本备注） */
export function TextAreaField({
  label,
  value,
  onCommit,
  placeholder,
  rows = 3,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);

  const commit = () => {
    if (text !== value) onCommit(text);
    else setText(value);
  };

  return (
    <label className="num-field num-field-col">
      <span className="num-field-label">{label}</span>
      <textarea
        className="input input-sm textarea-note"
        rows={rows}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
      />
    </label>
  );
}
