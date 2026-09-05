/**
 * 统计页签（T3.2 / FR-A01）：机房 → 排 → 机柜三级电力汇总 + 功率条。
 *
 * 三条设计取舍：
 * ① **图表手写 CSS 条形**，不引图表库（D2）：FR-A01 只要「列表 + 条形图」，一维横条用
 *    宽度百分比即可表达；为它拉进几百 KB 依赖不值（本仓连 favicon 都自己写光栅化）。
 * ② 数字全部来自 `@archview/core` 的 stats，本组件**不做任何业务计算**——
 *    InspectorPanel 里那份 5 行 reduce 已删除，同一指标绝不能有两处口径。
 * ③ 「未填 N 台」必须显眼：演示脚本里用户常常只填半数机柜，把「没填」显示成
 *    低利用率等于交出一张误导性的漂亮报表。
 */
import { useState } from 'react';
import { type RowPower } from '@archview/core';
import { useAppStore } from '../store/useAppStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { toastError, toastSuccess } from '../store/useToastStore';

/**
 * 功率显示：≥ 10kW 取整、否则留一位小数（面板上「8 kW」比「8.00 kW」好读）。
 * 导出供单测锁死口径——报表里 115.1 kW 被打成 115 kW 这种细节，肉眼很容易放过。
 */
export function kW(w: number): string {
  return w >= 10000 ? `${Math.round(w / 1000)} kW` : `${(w / 1000).toFixed(1)} kW`;
}

/** 利用率显示：null 走「—」而不是 0%（「无额定」与「满载 0%」是两件事） */
export function pct(r: number | null): string {
  return r === null ? '—' : `${(r * 100).toFixed(1)}%`;
}

/** 分档色：>100% error、>80% warning、其余 success（阈值集中此处，将来改一处即可） */
export function rateClass(r: number | null): string {
  if (r === null) return '';
  if (r > 1) return ' is-error';
  if (r > 0.8) return ' is-warn';
  return ' is-ok';
}

export default function StatsPanel() {
  const doc = useDocumentStore((s) => s.doc);
  const powerIndex = useDocumentStore((s) => s.powerIndex);
  // 订阅 rev：任意 Document 变更后本组件重渲染（只订阅、不读值，故不接变量）
  useDocumentStore((s) => s.rev);
  const autoArrangeRows = useDocumentStore((s) => s.autoArrangeRows);
  const readOnly = useAppStore((s) => s.readOnly);
  const setSelected = useAppStore((s) => s.setSelected);
  /** 展开的排（key=rowId；null 桶用固定串，因 Map 键不可为 null 以外的歧义值） */
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());

  // 每次渲染取一次即可：索引内部按排桶增量重算（未受影响的排直接复用缓存），
  // 而 rev 已让本组件在任意 Document 变更后重渲染——无需再拿它当 useMemo 的伪依赖。
  const stats = powerIndex.get();
  const maxLoadW = Math.max(1, ...stats.rows.map((r) => r.loadW));
  const looseRacks = doc.project.components.filter(
    (c) => !c.rowId && (doc.getType(c.typeId)?.uSlots ?? 0) > 0,
  ).length;

  const toggle = (key: string) =>
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const onAutoArrange = () => {
    const res = autoArrangeRows();
    if (!res) return;
    if (res.created === 0) {
      toastError('没有可编入的机柜（未成排的机柜不足两排，或都已归组）');
      return;
    }
    toastSuccess(`已按布局识别出 ${res.created} 排，归入 ${res.assigned} 台机柜（Ctrl+Z 可撤销）`);
  };

  const renderRow = (row: RowPower) => {
    const key = row.rowId ?? '__loose__';
    const open = openRows.has(key);
    return (
      <div className={`stats-row${row.rowId === null ? ' stats-row-loose' : ''}`} key={key}>
        <button className="stats-row-head" onClick={() => toggle(key)} type="button">
          <span className="stats-caret">{open ? '▾' : '▸'}</span>
          <span className="stats-name">{row.name}</span>
          <span className="stats-count">{row.count} 台</span>
          <span className="stats-val">{kW(row.loadW)}</span>
          <span className={`stats-rate${rateClass(row.loadRate)}`}>{pct(row.loadRate)}</span>
        </button>
        <div className="stats-bar" aria-hidden="true">
          <i style={{ width: `${(row.loadW / maxLoadW) * 100}%` }} />
        </div>
        {open && (
          <ul className="stats-units">
            {row.units.length === 0 && <li className="stats-unit-empty">此排暂无成员</li>}
            {row.units.map((u) => (
              <li key={u.id}>
                <button
                  className="stats-unit"
                  type="button"
                  title="点击选中该组件"
                  onClick={() => setSelected(u.id)}
                >
                  <span className="stats-name">{u.name}</span>
                  <span className="stats-val">
                    {kW(u.loadW)} <em>/ {kW(u.ratedW)}</em>
                  </span>
                  {!u.measured && <span className="stats-tag-unfilled">未填</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const p = stats.project;
  return (
    <div className="insp-body stats">
      <section className="stats-card">
        <h3 className="stats-h">机房总计</h3>
        <div className="kv">
          <div className="kv-row">
            <span>组件 / 机柜</span>
            <code>
              {stats.componentCount} / {stats.rackCount}
            </code>
          </div>
          <div className="kv-row">
            <span>额定功率合计</span>
            <code>{kW(p.ratedW)}</code>
          </div>
          <div className="kv-row">
            <span>实际负载合计</span>
            <code>{kW(p.loadW)}</code>
          </div>
          <div className="kv-row">
            <span>容量利用率</span>
            <code className={rateClass(p.loadRate)}>{pct(p.loadRate)}</code>
          </div>
        </div>
        {p.ratedW > 0 && (
          <div className="stats-bar stats-bar-total" aria-hidden="true">
            <i className={rateClass(p.loadRate).trim()} style={{ width: `${Math.min(100, (p.loadW / p.ratedW) * 100)}%` }} />
          </div>
        )}
        {p.unmeasured > 0 && (
          <p className="stats-warn">
            {p.unmeasured} 个组件未填实际负载，已按 0 计入——负载率偏低时请先补齐数据。
          </p>
        )}
      </section>

      <section className="stats-card">
        <div className="stats-h-row">
          {/* 「未成排」桶不算一排：标题里的数字只数真排，否则「分排（3）」会让人以为多了一排 */}
          <h3 className="stats-h">
            分排（{stats.rows.filter((r) => r.rowId !== null).length}）
          </h3>
          {!readOnly && looseRacks > 0 && (
            <button className="btn btn-sm" type="button" onClick={onAutoArrange}>
              自动成排
            </button>
          )}
        </div>
        {stats.rows.length === 0 && (
          <p className="muted">
            还没有排。摆放机柜后用「自动成排」按布局识别，或在工程里选中柜体后建排。
          </p>
        )}
        {stats.rows.map(renderRow)}
      </section>
    </div>
  );
}