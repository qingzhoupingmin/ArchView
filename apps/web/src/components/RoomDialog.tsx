import { useEffect, useState } from 'react';
import { findRoomOverlap, nextRoomPosition } from '@archview/core';
import { useAppStore } from '../store/useAppStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { toastSuccess } from '../store/useToastStore';
import Dialog from './Dialog';

/** 弹窗用米、Document 用 mm（§6.4 单位约定） */
const MM_PER_M = 1000;
/** 自动排布时两房间之间留的通道宽（mm）：3m = 一格主网格，贴边不共墙也不重叠 */
const ROOM_GAP_MM = 3000;

interface RoomDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 房间创建弹窗（T2.8 / P5，产品文档 §8.2-10）：v1 = 弹窗输入尺寸
 * （2D 矩形绘制推迟 P2+），确认 → AddRoomCommand（可撤销，FR-M08）。
 * P5 补三件事（对应「建造房间后与原始地板冲突」的截图反馈）：
 * ① 位置 X/Z 可输入，默认自动排到同楼层已有房间东侧——不再所有房间叠在世界原点上；
 * ② 楼层可填：上下叠层允许同占地，同层占地重叠则直接拦下；
 * ③ 重叠判定走 core findRoomOverlap，与渲染层同一份几何口径。
 */
export default function RoomDialog({ open, onClose }: RoomDialogProps) {
  const addRoom = useDocumentStore((s) => s.addRoom);
  const rooms = useDocumentStore((s) => s.doc.project.rooms);
  const roomCount = rooms.length;
  const gridStep = useAppStore((s) => s.gridStep);
  const [name, setName] = useState('');
  const [width, setWidth] = useState('30');
  const [depth, setDepth] = useState('20');
  const [height, setHeight] = useState('3.6');
  const [posX, setPosX] = useState('0');
  const [posZ, setPosZ] = useState('0');
  const [floorIndex, setFloorIndex] = useState('1');

  /** 表单 → mm（房间还没建，先按候选值校验用） */
  const num = (s: string) => Number(s.trim());
  const toMM = (s: string) => Math.round(num(s) * MM_PER_M);
  const candidate = () => ({
    width: toMM(width),
    depth: toMM(depth),
    floorIndex: Math.max(1, Math.round(num(floorIndex) || 1)),
    position: { x: toMM(posX), z: toMM(posZ) },
  });

  // 每次打开重置表单：名称按现有房间数自动编号 + 标准机房默认尺寸，
  // 位置自动排到同楼层已有房间的东侧（P5 R6：第二个房间不再叠在第一个身上）
  useEffect(() => {
    if (!open) return;
    setName(`机房 ${roomCount + 1}`);
    setWidth('30');
    setDepth('20');
    setHeight('3.6');
    setFloorIndex('1');
    const pos = nextRoomPosition(
      rooms,
      { width: 30 * MM_PER_M },
      { step: gridStep, gap: ROOM_GAP_MM, floorIndex: 1 },
    );
    setPosX(String(Math.round(pos.x / MM_PER_M)));
    setPosZ(String(Math.round(pos.z / MM_PER_M)));
    // 只在打开那一刻取 rooms / gridStep（弹窗期间数据不变），故不入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, roomCount]);

  const valid = name.trim() !== '' && num(width) > 0 && num(depth) > 0 && num(height) > 0;
  /** 同楼层占地重叠（P5 R6）：命中则给出房间名并拦下创建，避免两块地板共面叠在一起 */
  const overlapped = valid ? findRoomOverlap(candidate(), rooms) : undefined;
  const canSubmit = valid && !overlapped;

  const submit = () => {
    if (!canSubmit) return;
    const room = addRoom({
      name: name.trim(),
      width: toMM(width),
      depth: toMM(depth),
      height: toMM(height),
      floorIndex: Math.max(1, Math.round(num(floorIndex) || 1)),
      position: { x: toMM(posX), z: toMM(posZ) },
    });
    // 只读工程（他人工程，批次 B）：store 层守卫会拒绝创建，这里兜住不报错
    if (!room) return;
    toastSuccess(
      `已创建 ${room.name}（宽 ${room.width / MM_PER_M} × 深 ${room.depth / MM_PER_M}m）`,
    );
    onClose();
  };

  const numField = (
    label: string,
    value: string,
    set: (v: string) => void,
    opts: { min: number; max: number; step: number },
  ) => (
    <label className="field" key={label}>
      <span className="field-label">{label}</span>
      <input
        className="input"
        type="number"
        min={opts.min}
        max={opts.max}
        step={opts.step}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );

  return (
    <Dialog
      open={open}
      title="创建房间"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>
            创建
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
        <label className="field">
          <span className="field-label">房间名称</span>
          <input
            className="input"
            value={name}
            placeholder="例如：机房 1"
            maxLength={50}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <div className="field-grid">
          {numField('宽度（m）', width, setWidth, { min: 1, max: 500, step: 0.1 })}
          {numField('深度（m）', depth, setDepth, { min: 1, max: 500, step: 0.1 })}
          {numField('净高（m）', height, setHeight, { min: 1, max: 30, step: 0.1 })}
        </div>
        <div className="field-grid">
          {numField('位置 X（m）', posX, setPosX, { min: -500, max: 500, step: 0.6 })}
          {numField('位置 Z（m）', posZ, setPosZ, { min: -500, max: 500, step: 0.6 })}
          {numField('楼层', floorIndex, setFloorIndex, { min: 1, max: 20, step: 1 })}
        </div>
        {overlapped && (
          <p className="field-warn">
            与「{overlapped.name}」在同一楼层占地重叠：请调整位置 X / Z，或把它放到别的楼层。
          </p>
        )}
        <p className="muted">
          v1 弹窗输入尺寸创建（2D 矩形绘制推迟 P2+）；位置以占地中心计，
          默认自动排到同楼层已有房间的东侧，场地会随房间尺寸自动向外生长。
        </p>
      </form>
    </Dialog>
  );
}
