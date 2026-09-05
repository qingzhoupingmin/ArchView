import {
  RemoveComponentCommand,
  RemoveRoomCommand,
  TransformComponentCommand,
  UpdateComponentCommand,
  UpdateRoomCommand,
  normalizeDegrees,
  roomArea,
  typeSwatchColor,
  yawDegrees,
  yawQuaternion,
  type Category,
  type Component,
  type Room,
  type TransformFields,
} from '@archview/core';
import { VP_COMPONENT_DEFAULT } from '@archview/theme';
import { ComponentGlyph } from '@archview/ui';
import { useAppStore } from '../store/useAppStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { toastSuccess } from '../store/useToastStore';
import { guideTargetOf } from '../store/uiHints';
import StatsPanel from './StatsPanel';
import { ColorField, NumField, TextAreaField, TextField } from './fields';

/** 分类显示名（FR-D01；T2.9 新增 6 个一级分类） */
const CATEGORY_LABELS: Partial<Record<Category, string>> = {
  space: '空间',
  it: 'IT',
  power: '电力',
  cooling: '制冷',
  cable: '线缆',
  other: '其他',
  ac: '空调',
  furniture: '办公家具',
  fire: '消防',
  electrical: '电气',
  rack: '机柜',
  smart: '智能化',
};

function categoryLabel(cat?: Category): string {
  if (!cat) return '—';
  return CATEGORY_LABELS[cat] ?? cat;
}

/**
 * 属性 / 统计面板（FR-D / FR-A）。
 * T2.5：位置 / 尺寸 / 旋转（任意角度入口）精确输入（FR-M03，§8.2-9 size 单一事实源）、
 * 显示颜色（FR-D01）、名称 / 标签 / 长文本备注（FR-D05）、电力等业务属性、显隐、删除；U 位表在 P2（T5.1）。
 */
export default function InspectorPanel() {
  /**
   * 页签（T4.1 起挪进 useAppStore）：上手引导第 2 / 3 步需要把右栏直接切到
   * 「属性」/「统计」，本地 useState 做不到跨组件导航。
   */
  const tab = useAppStore((s) => s.inspectorTab);
  const setTab = useAppStore((s) => s.setInspectorTab);
  /** 当前引导步指向哪儿（未打开引导时为 null） */
  const guideTarget = useAppStore((s) => guideTargetOf(s.guideStep ?? -1));

  const selectedId = useAppStore((s) => s.selectedId);
  const selectedIds = useAppStore((s) => s.selectedIds);
  /** 选中的房间（P5：房间可拾取，与组件选择集互斥） */
  const selectedRoomId = useAppStore((s) => s.selectedRoomId);
  const setSelectedRoom = useAppStore((s) => s.setSelectedRoom);
  const setSelected = useAppStore((s) => s.setSelected);
  const doc = useDocumentStore((s) => s.doc);
  useDocumentStore((s) => s.rev);

  const comp: Component | undefined = selectedId ? doc.getComponent(selectedId) : undefined;
  /** 选中的房间（P5）：房间有了自己的属性卡 */
  const room = selectedRoomId ? doc.getRoom(selectedRoomId) : undefined;
  const type = comp ? doc.getType(comp.typeId) : undefined;
  const attrs = type?.defaultAttrs ?? {};
  /** 生效显示色：与渲染层 primColorOf 同优先级（实例色 → 类型代表色 → 主题默认）（FR-D01） */
  const effectiveColor = (
    comp?.color ??
    (type ? typeSwatchColor(type) : undefined) ??
    VP_COMPONENT_DEFAULT
  ).toLowerCase();

  const commitTransform = (after: Partial<TransformFields>) => {
    if (comp) doc.execute(new TransformComponentCommand([{ id: comp.id, after }]));
  };
  const commitPatch = (patch: Partial<Component>) => {
    if (comp) doc.execute(new UpdateComponentCommand(comp.id, patch));
  };
  /** 房间字段提交（P5）：一律走 UpdateRoomCommand，单条撤销记录（FR-M08） */
  const commitRoom = (patch: Partial<Omit<Room, 'id'>>) => {
    if (room) doc.execute(new UpdateRoomCommand(room.id, patch));
  };
  /** 删除房间（P5）：v1 不级联组件，房内设备保留（core removeRoom 约定） */
  const removeRoom = () => {
    if (!room) return;
    doc.execute(new RemoveRoomCommand(room.id));
    setSelectedRoom(null);
    toastSuccess(`已删除 ${room.name}`);
  };
  const setAttr = (key: string, v: number | boolean) => {
    if (!comp) return;
    commitPatch({ attrs: { ...comp.attrs, [key]: v } });
  };

  /** 删除（T2.4：多选时一次删整个选择集 = 单条 RemoveComponentCommand = 单条撤销记录，FR-M08） */
  const removeComp = () => {
    if (!comp) return;
    const ids =
      useAppStore.getState().selectedIds.length > 0
        ? useAppStore.getState().selectedIds
        : [comp.id];
    doc.execute(new RemoveComponentCommand(ids));
    setSelected(null);
    toastSuccess(ids.length > 1 ? `已删除 ${ids.length} 个组件` : `已删除 ${comp.name}`);
  };

  // 电力字段（按类型决定展示哪些，FR-A01）
  const powerFields: { key: string; label: string }[] = [];
  if (comp && type?.uSlots) {
    powerFields.push(
      { key: 'ratedPowerW', label: '额定功率(W)' },
      { key: 'actualLoadW', label: '实际负载(W)' },
    );
  } else if ('powerW' in attrs) {
    powerFields.push({ key: 'powerW', label: '功耗(W)' });
  }
  const genericFields = [
    { key: 'capacityKW', label: '容量(kW)' },
    { key: 'outputKW', label: '容量(kW)' },
    { key: 'coolingKW', label: '制冷量(kW)' },
    { key: 'capacityKVA', label: '容量(kVA)' },
    { key: 'capacityKWH', label: '容量(kWh)' },
    { key: 'lengthMM', label: '长度(mm)' },
    { key: 'moduleCount', label: '模块数' },
  ].filter((f) => f.key in attrs);
  /** 布尔参数（T2.9 模块化机房单/双排）：与数值参数分离，用开关渲染 */
  const boolFields = [{ key: 'doubleRow', label: '双排布局' }].filter(
    (f) => typeof attrs[f.key] === 'boolean',
  );

  // 电力 / 排 / 机柜三级汇总改由 StatsPanel 消费 core/stats（T3.2）——
  // 此处原有的一份 reduce 已删除：同一指标两处口径迟早对不上账（且它把「额定」与
  // 「设备功耗」混读成同一个数）。

  /** 引导高亮：只有「本步指向的页签正好是当前页签」才亮，两处同时闪等于没指路 */
  const onboardHl =
    (guideTarget === 'props' && tab === 'props') || (guideTarget === 'stats' && tab === 'stats');

  return (
    <div className={'insp' + (onboardHl ? ' onboard-hl' : '')}>
      <div className="tab-bar">
        <button
          className={`tab-item${tab === 'props' ? ' active' : ''}`}
          onClick={() => setTab('props')}
        >
          属性
        </button>
        <button
          className={`tab-item${tab === 'stats' ? ' active' : ''}`}
          onClick={() => setTab('stats')}
        >
          统计
        </button>
      </div>
      {tab === 'props' ? (
        comp ? (
          <div className="insp-body">
            {selectedIds.length > 1 && (
              <p className="insp-multi-hint">
                已选 {selectedIds.length} 个组件 · 正在编辑「{comp.name}」
              </p>
            )}
            <div className="insp-section">
              <p className="insp-name">
                <ComponentGlyph typeId={comp.typeId} category={type?.category} size={16} />
                <span>{comp.name}</span>
              </p>
              <p className="insp-type">
                <span>{type?.name ?? comp.typeId}</span>
                <span className="insp-cat">{categoryLabel(type?.category)}</span>
              </p>
            </div>

            <div className="insp-section">
              <p className="insp-section-title">位置（mm）</p>
              <NumField
                label="X"
                value={comp.position.x}
                step={600}
                onCommit={(v) =>
                  commitTransform({ position: { x: v, y: comp.position.y, z: comp.position.z } })
                }
              />
              <NumField
                label="Y"
                value={comp.position.y}
                step={100}
                onCommit={(v) =>
                  commitTransform({ position: { x: comp.position.x, y: v, z: comp.position.z } })
                }
              />
              <NumField
                label="Z"
                value={comp.position.z}
                step={600}
                onCommit={(v) =>
                  commitTransform({ position: { x: comp.position.x, y: comp.position.y, z: v } })
                }
              />
            </div>

            <div className="insp-section">
              <p className="insp-section-title">尺寸（mm）</p>
              <NumField
                label="宽"
                value={comp.size.w}
                step={50}
                onCommit={(v) =>
                  commitTransform({ size: { w: v, d: comp.size.d, h: comp.size.h } })
                }
              />
              <NumField
                label="深"
                value={comp.size.d}
                step={50}
                onCommit={(v) =>
                  commitTransform({ size: { w: comp.size.w, d: v, h: comp.size.h } })
                }
              />
              <NumField
                label="高"
                value={comp.size.h}
                step={50}
                onCommit={(v) =>
                  commitTransform({ size: { w: comp.size.w, d: comp.size.d, h: v } })
                }
              />
            </div>

            <div className="insp-section">
              <p className="insp-section-title">旋转（°）</p>
              <NumField
                label="偏航"
                value={Math.round(yawDegrees(comp.rotation) * 100) / 100}
                step={90}
                onCommit={(v) => commitTransform({ rotation: yawQuaternion(normalizeDegrees(v)) })}
              />
              <div className="insp-rot-presets">
                {[0, 90, 180, 270].map((deg) => (
                  <button
                    key={deg}
                    className={`insp-rot-preset${
                      Math.round(yawDegrees(comp.rotation)) % 360 === deg ? ' active' : ''
                    }`}
                    onClick={() => commitTransform({ rotation: yawQuaternion(deg) })}
                  >
                    {deg}°
                  </button>
                ))}
              </div>
            </div>

            <div className="insp-section">
              <p className="insp-section-title">外观</p>
              <ColorField
                label="显示颜色"
                value={effectiveColor}
                onCommit={(v) => commitPatch({ color: v })}
              />
              {comp.color && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => commitPatch({ color: undefined })}
                >
                  恢复类型默认色
                </button>
              )}
            </div>

            {powerFields.length > 0 && (
              <div className="insp-section">
                <p className="insp-section-title">电力</p>
                {powerFields.map((f) => (
                  <NumField
                    key={f.key}
                    label={f.label}
                    step={100}
                    value={Number(comp.attrs[f.key] ?? 0)}
                    onCommit={(v) => setAttr(f.key, v)}
                  />
                ))}
              </div>
            )}

            {genericFields.length > 0 && (
              <div className="insp-section">
                <p className="insp-section-title">参数</p>
                {genericFields.map((f) => (
                  <NumField
                    key={f.key}
                    label={f.label}
                    value={Number(comp.attrs[f.key] ?? 0)}
                    onCommit={(v) => setAttr(f.key, v)}
                  />
                ))}
              </div>
            )}

            {boolFields.length > 0 && (
              <div className="insp-section">
                <p className="insp-section-title">参数（开关）</p>
                {boolFields.map((f) => (
                  <label key={f.key} className="num-field">
                    <span className="num-field-label">{f.label}</span>
                    <input
                      type="checkbox"
                      checked={comp.attrs[f.key] === true}
                      onChange={(e) => setAttr(f.key, e.target.checked)}
                    />
                  </label>
                ))}
              </div>
            )}

            <div className="insp-section">
              <p className="insp-section-title">其它</p>
              <TextField
                label="名称"
                value={comp.name}
                onCommit={(v) => commitPatch({ name: v || comp.name })}
              />
              <TextField
                label="标签"
                placeholder="逗号分隔"
                value={comp.tags.join(', ')}
                onCommit={(v) =>
                  commitPatch({
                    tags: v
                      .split(/[,，]/)
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                }
              />
              <TextAreaField
                label="备注"
                placeholder="备注信息（Enter 提交，Shift+Enter 换行）"
                value={comp.note}
                onCommit={(v) => commitPatch({ note: v })}
              />
              <label className="insp-check">
                <input
                  type="checkbox"
                  checked={comp.visible}
                  onChange={(e) => commitPatch({ visible: e.target.checked })}
                />
                显示
              </label>
            </div>

            <div className="insp-actions">
              <button className="btn" onClick={removeComp}>
                删除组件（Del）
              </button>
            </div>
          </div>
        ) : room ? (
          <div className="insp-body">
            <div className="insp-section">
              <p className="insp-name">
                <span>{room.name}</span>
                <span className="insp-cat">房间</span>
              </p>
              <p className="insp-type">
                <span>{`占地 ${(room.width / 1000).toFixed(1)} × ${(room.depth / 1000).toFixed(1)} m · 面积 ${(roomArea(room) / 1e6).toFixed(1)} m²`}</span>
                <span className="insp-cat">第 {room.floorIndex} 层</span>
              </p>
            </div>
            <div className="insp-section">
              <p className="insp-section-title">尺寸（mm）</p>
              <NumField
                label="宽 W"
                value={room.width}
                step={600}
                onCommit={(v) => commitRoom({ width: Math.max(1, Math.round(v)) })}
              />
              <NumField
                label="深 D"
                value={room.depth}
                step={600}
                onCommit={(v) => commitRoom({ depth: Math.max(1, Math.round(v)) })}
              />
              <NumField
                label="净高 H"
                value={room.height}
                step={100}
                onCommit={(v) => commitRoom({ height: Math.max(1, Math.round(v)) })}
              />
            </div>
            <div className="insp-section">
              <p className="insp-section-title">位置与楼层（mm）</p>
              <NumField
                label="X（占地中心）"
                value={room.position.x}
                step={600}
                onCommit={(v) => commitRoom({ position: { x: Math.round(v), z: room.position.z } })}
              />
              <NumField
                label="Z（占地中心）"
                value={room.position.z}
                step={600}
                onCommit={(v) => commitRoom({ position: { x: room.position.x, z: Math.round(v) } })}
              />
              <NumField
                label="楼层"
                value={room.floorIndex}
                step={1}
                onCommit={(v) => commitRoom({ floorIndex: Math.max(1, Math.round(v)) })}
              />
            </div>
            <div className="insp-section">
              <p className="insp-section-title">其它</p>
              <TextField
                label="名称"
                value={room.name}
                onCommit={(v) => commitRoom({ name: v || room.name })}
              />
            </div>
            <div className="insp-actions">
              <button className="btn" onClick={removeRoom}>
                删除房间（Del）
              </button>
            </div>
          </div>
        ) : (
          <div className="insp-empty">在视口中单击组件或房间地板选中后，这里显示其属性</div>
        )
      ) : (
        <StatsPanel />
      )}
    </div>
  );
}
