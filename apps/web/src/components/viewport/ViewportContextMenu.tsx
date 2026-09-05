import type { Component, ComponentType, Room } from '@archview/core';
import { roomArea } from '@archview/core';
import type { CtxMenu } from '../../hooks/useViewportBridge';

interface Props {
  menu: CtxMenu;
  /** 命中的组件 / 类型 / 房间（实时取自 doc；菜单打开期间被删则为 undefined → 落回空处分支） */
  comp?: Component;
  type?: ComponentType;
  room?: Room;
  selectedId: string | null;
  selectedRoomId: string | null;
  onFocusComp(): void;
  onArray(): void;
  onMirror(): void;
  onRemoveComp(): void;
  onFocusRoom(): void;
  onRemoveRoom(): void;
  onResetView(): void;
  onLocate(): void;
  onClose(): void;
}

/**
 * 右键详情菜单（交互范式改版 §10.3，2D/3D 共用）：组件 / 房间详情 + 动作；空处 = 视图操作。
 *
 * 从 Viewport.tsx 抽出的原因：它是纯展示 + 回调，却要读 `doc` 现算命中对象，
 * 120 行 JSX 混在视口宿主组件里，把真正需要小心的生命周期代码挤到了视线之外。
 * 靠近边缘时的向内收拢由 onContextMenu 回调负责（那里才有容器尺寸），本组件只管画。
 */
export function ViewportContextMenu({
  menu,
  comp,
  type,
  room,
  selectedId,
  selectedRoomId,
  onFocusComp,
  onArray,
  onMirror,
  onRemoveComp,
  onFocusRoom,
  onRemoveRoom,
  onResetView,
  onLocate,
  onClose,
}: Props) {
  /** 每个动作都要顺手关菜单（点完就消失，与 §10.3 的「详情菜单」一次性语义一致） */
  const item = (fn: () => void) => () => {
    fn();
    onClose();
  };
  return (
    <div
      className="vp-ctx"
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {comp ? (
        <>
          <div className="vp-ctx-head">
            <span className="vp-ctx-title">{comp.name}</span>
            {type && <span className="vp-ctx-sub">{type.name}</span>}
          </div>
          <div className="vp-ctx-info">
            尺寸 {comp.size.w}×{comp.size.d}×{comp.size.h} mm
            <br />
            位置 ({Math.round(comp.position.x)}, {Math.round(comp.position.z)})
          </div>
          <button type="button" className="vp-ctx-item" title="平移到该组件（保持缩放）" onClick={item(onFocusComp)}>
            聚焦
          </button>
          <button type="button" className="vp-ctx-item" title="矩形阵列：快速成排摆放（FR-M05）" onClick={item(onArray)}>
            阵列
          </button>
          <button type="button" className="vp-ctx-item" title="镜像复制：沿中心线生成副本（FR-M05）" onClick={item(onMirror)}>
            镜像
          </button>
          <button type="button" className="vp-ctx-item" onClick={item(onRemoveComp)}>
            删除
          </button>
        </>
      ) : room ? (
        <>
          <div className="vp-ctx-head">
            <span className="vp-ctx-title">{room.name}</span>
            <span className="vp-ctx-sub">房间</span>
          </div>
          <div className="vp-ctx-info">
            {room.width}×{room.depth} mm · 净高 {room.height} mm
            <br />
            面积 {(roomArea(room) / 1e6).toFixed(1)} m²
          </div>
          <button
            type="button"
            className="vp-ctx-item"
            title="平移到房间中心（保持缩放）"
            onClick={item(onFocusRoom)}
          >
            聚焦
          </button>
          <button type="button" className="vp-ctx-item" onClick={item(onRemoveRoom)}>
            删除房间
          </button>
        </>
      ) : (
        <>
          <button type="button" className="vp-ctx-item" onClick={item(onResetView)}>
            重置机位
          </button>
          <button
            type="button"
            className="vp-ctx-item"
            disabled={!selectedId && !selectedRoomId}
            title={selectedId || selectedRoomId ? '平移到选中对象（保持缩放）' : '先选择一个对象'}
            onClick={item(onLocate)}
          >
            定位选中
          </button>
        </>
      )}
    </div>
  );
}
