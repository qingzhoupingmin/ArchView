import { useMemo, useState } from 'react';
import { snapToGrid, type ComponentType } from '@archview/core';
import { componentTypes } from '@archview/component-lib';
import { ComponentGlyph } from '@archview/ui';
import { useAppStore } from '../store/useAppStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { toastSuccess } from '../store/useToastStore';
import { guideTargetOf } from '../store/uiHints';

const CATEGORIES = [
  { key: 'all', label: '全部' },
  { key: 'space', label: '空间' },
  { key: 'it', label: 'IT' },
  { key: 'power', label: '电力' },
  { key: 'cooling', label: '制冷' },
  { key: 'cable', label: '线缆' },
  { key: 'ac', label: '空调' },
  { key: 'furniture', label: '办公家具' },
  { key: 'fire', label: '消防' },
  { key: 'electrical', label: '电气' },
  { key: 'rack', label: '机柜' },
  { key: 'smart', label: '智能化' },
  { key: 'other', label: '其他' },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]['key'];

/**
 * 组件库面板（FR-M01 / T2.1 · T2.2 · T2.9）：12 分类导航 + 关键词搜索 + 组件卡片（名称 / 默认尺寸 / 图标），首批 53 项（T2.9：8 项改归类 + 30 项新增）。
 * T2.2 拖放放置（FR-M02 / M04）：把卡片拖入视口，幽灵预览随网格吸附实时跟手，松手放置；
 * S2.0c：点击放置保留为拖放兜底（点击卡片 → 放置到光标处，600mm 网格吸附）。
 */
export default function ComponentLibrary() {
  const [active, setActive] = useState<CategoryKey>('all');
  const [keyword, setKeyword] = useState('');
  const place = useDocumentStore((s) => s.place);
  const setSelected = useAppStore((s) => s.setSelected);
  /** 只读（他人工程，批次 B）：卡片直接 disabled —— 拖不动也点不动，比「拖了没反应」诚实 */
  const readOnly = useAppStore((s) => s.readOnly);

  const items = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return componentTypes.filter(
      (t) =>
        (active === 'all' || t.category === active) &&
        (kw === '' || t.name.toLowerCase().includes(kw)),
    );
  }, [active, keyword]);

  const handlePlace = (type: ComponentType) => {
    const app = useAppStore.getState();
    // 放置位置：光标处（吸附），否则默认 1200,1200
    let x = 1200;
    let z = 1200;
    if (app.cursor) {
      x = app.cursor.x;
      z = app.cursor.z;
    }
    if (app.gridSnap) {
      x = snapToGrid(x, app.gridStep);
      z = snapToGrid(z, app.gridStep);
    }
    const comp = place(type.id, { x, y: 0, z });
    if (comp) {
      setSelected(comp.id);
      toastSuccess(`已放置 ${comp.name}`);
    }
  };

  /** 上手引导第 1 步指向本面板：绕一圈高亮比让用户自己找面板快（T4.1） */
  const guideTarget = useAppStore((s) => guideTargetOf(s.guideStep ?? -1));

  return (
    <div className={'lib' + (guideTarget === 'left' ? ' onboard-hl' : '')}>
      <div className="panel-header">
        <span className="panel-title">组件库</span>
        {readOnly ? (
          <span className="badge badge-muted" title="该工程属于其他账号，写权限仅属主">
            只读 · 不可放置
          </span>
        ) : (
          <span className="muted">{items.length} 项</span>
        )}
      </div>
      <div className="lib-search">
        <input
          className="input"
          placeholder="搜索组件名称"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>
      <div className="lib-cats">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            className={`lib-cat${active === c.key ? ' active' : ''}`}
            onClick={() => setActive(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {items.length > 0 ? (
        <div className="lib-list">
          {items.map((t) => (
            <button
              key={t.id}
              className="lib-card"
              draggable={!readOnly}
              disabled={readOnly}
              onDragStart={(e) => {
                // T2.2：携带类型 ID（text/plain 兼容性最好）；拖拽状态入 store 供 Viewport 渲染幽灵预览
                e.dataTransfer.setData('text/plain', t.id);
                e.dataTransfer.effectAllowed = 'copy';
                useAppStore.getState().setDraggingTypeId(t.id);
              }}
              onDragEnd={() => useAppStore.getState().setDraggingTypeId(null)}
              onClick={() => handlePlace(t)}
              title={
                readOnly
                  ? '他人工程为只读：写权限仅属主，无法放置组件'
                  : '拖放到视口放置 · 点击放置到光标处（兜底）'
              }
            >
              <span className="lib-card-icon">
                <ComponentGlyph typeId={t.id} category={t.category} size={20} />
              </span>
              <span className="lib-card-name">{t.name}</span>
              <span className="lib-card-size">
                {t.defaultSize.w}×{t.defaultSize.d}×{t.defaultSize.h}mm
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="lib-empty">
          <p>没有匹配的组件</p>
          <p className="muted">试试其它关键词或分类</p>
        </div>
      )}
    </div>
  );
}
