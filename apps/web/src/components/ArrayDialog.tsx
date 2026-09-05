import { useEffect, useState } from 'react';
import { defaultArraySpacing } from '@archview/core';
import { useAppStore } from '../store/useAppStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { toastSuccess } from '../store/useToastStore';
import Dialog from './Dialog';

interface ArrayDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 矩形阵列弹窗（T2.3 / FR-M05）：行 / 列 / 列距 / 行距可配，快速摆放成排机柜。
 * 第一格锚定选中组件当前位置，向 +X（列）/ +Z（行）展开（与黄金样例 / 性能基线同一约定）；
 * 间距默认 = 列距「宽 + 600」/ 行距「深 + 1200」（中间冷通道）；
 * 确认 → 单条 AddComponentCommand（一次撤销全部移除，FR-M08）→ 选中阵列第一格。
 */
export default function ArrayDialog({ open, onClose }: ArrayDialogProps) {
  const doc = useDocumentStore((s) => s.doc);
  const rectArray = useDocumentStore((s) => s.rectArray);
  const selectedId = useAppStore((s) => s.selectedId);
  const setSelected = useAppStore((s) => s.setSelected);
  const [rows, setRows] = useState('2');
  const [cols, setCols] = useState('10');
  const [dx, setDx] = useState('1200');
  const [dz, setDz] = useState('2200');

  const base = selectedId ? doc.getComponent(selectedId) : null;

  // 每次打开重置表单：间距默认值按组件尺寸推导（黄金样例约定）
  useEffect(() => {
    if (open && base) {
      const sp = defaultArraySpacing(base.size);
      setRows('2');
      setCols('10');
      setDx(String(sp.dx));
      setDz(String(sp.dz));
    }
  }, [open, base]);

  const num = (s: string) => Number(s.trim());
  const r = Math.round(num(rows));
  const c = Math.round(num(cols));
  const valid =
    !!base && r >= 1 && r <= 50 && c >= 1 && c <= 50 && num(dx) > 0 && num(dz) > 0;

  // 阵列整体占地（含首末格本体），供用户预估
  const totalW = base ? (c - 1) * num(dx) + base.size.w : 0;
  const totalD = base ? (r - 1) * num(dz) + base.size.d : 0;

  const submit = () => {
    if (!valid || !base) return;
    const added = rectArray(base.id, { rows: r, cols: c, dx: num(dx), dz: num(dz) });
    toastSuccess(`已放置 ${added.length} 个组件（${r} 行 × ${c} 列矩形阵列）`);
    if (added.length > 0) setSelected(added[0].id);
    onClose();
  };

  return (
    <Dialog
      open={open}
      title={`矩形阵列 · ${base?.name ?? '组件'}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={!valid} onClick={submit}>
            {'阵列 ' + r * c + ' 件'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="array-grid">
          <label className="field">
            <span className="field-label">行数（+Z）</span>
            <input
              className="input"
              type="number"
              min="1"
              max="50"
              step="1"
              value={rows}
              onChange={(e) => setRows(e.target.value)}
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">列数（+X）</span>
            <input
              className="input"
              type="number"
              min="1"
              max="50"
              step="1"
              value={cols}
              onChange={(e) => setCols(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">列间距（mm）</span>
            <input
              className="input"
              type="number"
              min="100"
              step="100"
              value={dx}
              onChange={(e) => setDx(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">行间距（mm）</span>
            <input
              className="input"
              type="number"
              min="100"
              step="100"
              value={dz}
              onChange={(e) => setDz(e.target.value)}
            />
          </label>
        </div>
        <p className="muted">
          第一格锚定选中组件当前位置，向 +X / +Z 展开
          {valid && (
            <>
              ；整体占地约 {(totalW / 1000).toFixed(1)}m × {(totalD / 1000).toFixed(1)}m
              ，网格吸附生效时逐格对齐。
            </>
          )}
        </p>
      </form>
    </Dialog>
  );
}