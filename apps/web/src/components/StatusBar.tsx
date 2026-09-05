import { lodPolicyLabel, nextLodPolicy } from '@archview/core';
import { useAppStore } from '../store/useAppStore';
import { viewportRef } from '../store/viewportRef';

/** 吸附步长循环表（点击切换，对应组件库默认 600mm 模数 FR-M04） */
const STEPS = [300, 600, 1200];

/**
 * 状态栏（§10.1 / §10.3）：坐标 · 多选数 · 吸附 · 步长 · 缩放 · 细节档 · 合批 · 阴影 · 绘制调用 · fps。
 * P2：吸附 / 步长 / 缩放从纯文本改为可点击 chip（此前只能靠 G / 滚轮等键盘鼠标约定）。
 * T2.7：多选时显示「已选 N」（与属性面板提示呼应，状态栏更醒目）。
 * T2.12：新增「细节档」chip——把 LOD 从黑盒变成可见可调（自动档额外显示当前实际落在近/远）。
 * T2.10g / T2.10a：新增「合批」「阴影」chip 与「绘制 N · 桶 M」读数——
 * 帧率预算的开关与效果必须让主人不打开控制台就能看见、就能一键对比两档。
 */
export default function StatusBar() {
  const cursor = useAppStore((s) => s.cursor);
  const gridSnap = useAppStore((s) => s.gridSnap);
  const gridStep = useAppStore((s) => s.gridStep);
  const zoomPct = useAppStore((s) => s.zoomPct);
  const fps = useAppStore((s) => s.fps);
  const lodPolicy = useAppStore((s) => s.lodPolicy);
  const lodMode = useAppStore((s) => s.lodMode);
  /** 批渲染 / 阴影双路开关（T2.10g / T2.10a）：chip 直接切渲染层，并回显当前档 */
  const batching = useAppStore((s) => s.batching);
  const shadowMode = useAppStore((s) => s.shadowMode);
  /** 上一统计帧的绘制调用与实例桶数（合批效果要在界面上看得见，不能只在控制台） */
  const drawCalls = useAppStore((s) => s.drawCalls);
  const buckets = useAppStore((s) => s.buckets);
  const selectedCount = useAppStore((s) => s.selectedIds.length);

  const cycleStep = () => {
    const app = useAppStore.getState();
    const i = STEPS.indexOf(app.gridStep);
    app.setGridStep(STEPS[(i + 1) % STEPS.length]);
  };

  /** 细节档循环（与快捷键 L 同一动作，§10.3）：自动 → 近档 → 远档 */
  const cycleLod = () => {
    const app = useAppStore.getState();
    const next = nextLodPolicy(app.lodPolicy);
    app.setLodPolicy(next);
    viewportRef.current?.setLodPolicy(next);
  };

  const pos = cursor ? Math.round(cursor.x) + ', ' + Math.round(cursor.z) + ' mm' : '—, — mm';

  return (
    <footer className="statusbar">
      <span>坐标 {pos}</span>
      {selectedCount > 1 && (
        <>
          <span className="statusbar-sep" aria-hidden="true" />
          <span className="sb-selected">已选 {selectedCount}</span>
        </>
      )}
      <span className="statusbar-sep" aria-hidden="true" />
      <button
        className="sb-chip"
        aria-pressed={gridSnap}
        onClick={() => useAppStore.getState().toggleSnap()}
        title="点击切换网格吸附（快捷键 G）"
      >
        {'吸附 ' + (gridSnap ? '开' : '关')}
      </button>
      <button className="sb-chip" onClick={cycleStep} title="点击循环吸附步长 300 / 600 / 1200mm">
        {'步长 ' + gridStep + 'mm'}
      </button>
      <span className="statusbar-sep" aria-hidden="true" />
      <span className="statusbar-group">
        <button
          className="sb-chip"
          onClick={() => viewportRef.current?.zoomBy(1 / 1.25)}
          aria-label="缩小"
          title="缩小"
        >
          −
        </button>
        <button
          className="sb-chip sb-value"
          onClick={() => viewportRef.current?.resetView()}
          title="点击重置机位"
        >
          {Math.round(zoomPct) + '%'}
        </button>
        <button
          className="sb-chip"
          onClick={() => viewportRef.current?.zoomBy(1.25)}
          aria-label="放大"
          title="放大"
        >
          +
        </button>
      </span>
      <span className="statusbar-sep" aria-hidden="true" />
      <button
        className="sb-chip"
        onClick={cycleLod}
        title="素材细节档（快捷键 L）：自动 = 相机拉近至 6m 内显示 near 细节件、拉远至 8.5m 外回退；近档 / 远档 = 手动锁定"
      >
        {lodPolicyLabel(lodPolicy) +
          (lodPolicy === 'auto' ? '（' + (lodMode === 'near' ? '近' : '远') + '）' : '')}
      </button>
      <span className="statusbar-sep" aria-hidden="true" />
      <button
        className="sb-chip"
        aria-pressed={batching === 'on'}
        onClick={() => useAppStore.getState().toggleBatching()}
        title="实例化批渲染（T2.10g）：开 = 同几何 + 同材质档的图元合进一次 draw call；关 = 每图元一只 mesh（旧实现，一键回退）。两档画面必须完全一致，不一致即为缺陷"
      >
        {'合批 ' + (batching === 'on' ? '开' : '关')}
      </button>
      <button
        className="sb-chip"
        aria-pressed={shadowMode === 'on'}
        onClick={() => useAppStore.getState().toggleShadowMode()}
        title="阴影通道（T2.10a 性能模式）：关 = 省掉约一半绘制调用，密集阵列兜帧率"
      >
        {'阴影 ' + (shadowMode === 'on' ? '开' : '关')}
      </button>
      {drawCalls > 0 && (
        <span
          className="sb-chip sb-value"
          title="上一统计帧的绘制调用数（500ms 节拍）。开批后「桶数」= 合批给出的单通道上限，阴影通道另算一次"
        >
          {'绘制 ' + drawCalls + (batching === 'on' ? ' · 桶 ' + buckets : '')}
        </span>
      )}
      <span className="sb-fps">{fps > 0 ? fps + ' fps' : '— fps'}</span>
    </footer>
  );
}
