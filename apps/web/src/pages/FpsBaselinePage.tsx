import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { dateStamp, downloadTextFile, toCsv } from '@archview/io';
import { Viewport3D } from '@archview/renderer';
import { toastError, toastSuccess } from '../store/useToastStore';
import {
  REPORT_COLUMNS,
  REPORT_CSV_COLUMNS,
  reportMarkdown,
  type ReportRow,
} from './fpsReport';
import { SCENARIOS, type Scenario } from './fps/scenarios';


/**
 * 性能基线页（S2.0d / T3.6，开发计划 §8）：自定义帧率采样工具。
 * 路由 /fps（开发工具，免登录）；入口 `pnpm fps`。
 *
 * - 场景（四档，见 SCENARIOS）：标准机房样例（26，参考档）/ 10×10 机柜阵列（100，M1 目标 60fps）
 *   / **20×20 密集阵列（400，唯一吃满阴影视锥的一档）** / 50×20 机柜阵列（1000，v1.0 目标 55fps）
 * - 采样：静止 3s（500ms × 6 样本）→ 环绕 3s（autoRotate 相机运动负载）→ 报告 min/avg fps + draw calls / 三角形数
 * - 用法：T2.3 开工前跑一次留基线（矩形阵列为首个多对象压力点，X5）；
 *   每个 sprint 复跑确认不回归（帧率下降 > 10% 即立专项）。
 * - URL 参数：`?auto=sample` 只跑黄金样例；**`?auto=all` 顺序跑完全部四档**（v3.7 新增，
 *   把「一轮基线 = 手点 4 次 × 等 7s × 手抄 4 行」降到「打开一条链接，等约 30s」）；
 *   `?lod=near|far|auto` 锁定素材细节档（T2.12）——
 *   不锁时相机会按距离自动升降档，同一场景两次采样可能落在不同档，数值不可跨环境比较。
 *   `?batch=on|off` 锁批渲染档（T2.10g 实例化）、`?noshadow=1` 关阴影通道（T2.10a 性能模式）——
 *   基线表要求的「开 / 关阴影两组数值」与「合批省下多少 draw call」都靠这两个参数成对量出来。
 *
 * **16 格测量 SOP（开发计划 §4.2 S2.0d 的「四档 × 开批/关批 × 开/关阴影」）**：
 * 依次打开下面四条链接，每条跑完点「复制为 Markdown」把表贴走——
 * 1. `/fps?auto=all&batch=on`                 开批 + 开阴影
 * 2. `/fps?auto=all&batch=on&noshadow=1`      开批 + 关阴影（算「阴影吃掉多少」）
 * 3. `/fps?auto=all&batch=off`                关批 + 开阴影（= 旧实现，对照基准）
 * 4. `/fps?auto=all&batch=off&noshadow=1`     关批 + 关阴影
 * 每行的「档位」列会记录当时生效的三档组合，因此混在一张表里也不会串行（v3.7 补）。
 * 环境列（GPU / DPR / 是否全屏）请一并记进开发计划基线表，否则跨 sprint 数值不可比。
 */

const SAMPLES = 6; // 每阶段 500ms 采样数
const PHASE_MS = SAMPLES * 500 + 500; // 留 1 个样本缓冲，避免相位边界丢失
/** ?auto=all 场景间隔（ms）：让上一场景的收尾工作（关 autoRotate / 释放 shadow map）落地再建下一场景 */
const GAP_MS = 300;

/**
 * 兜底复制：`navigator.clipboard` 只在**安全上下文**（https / localhost）存在，
 * 而 /fps 常常就在 `http://<内网IP>/fps` 这类内网 http 地址下打开——
 * 那时它是 undefined，不兜底就等于「复制按钮在这台机器上永远点了没反应」。
 */
function legacyCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand('copy')) throw new Error('execCommand 返回 false');
  } finally {
    ta.remove();
  }
}


function avgOf(xs: number[]): number {
  return xs.length > 0 ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
}

function minOf(xs: number[]): number {
  return xs.length > 0 ? Math.min(...xs) : 0;
}

// 报告的列定义 / Markdown 与 CSV 拼装抽到 ./fpsReport（纯字符串逻辑，可离线单测，
// 且页面表格与两种导出必须共用同一份列，不能各写一份）。


export default function FpsBaselinePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<Viewport3D | null>(null);
  const phaseRef = useRef<'idle' | 'orbit' | 'none'>('none');
  const idleSamplesRef = useRef<number[]>([]);
  const orbitSamplesRef = useRef<number[]>([]);
  const timersRef = useRef<number[]>([]);
  /** 采样互斥标志（同步可读版；`running` state 只用来驱动按钮禁用，见 runScenario 注释） */
  const runningRef = useRef(false);
  /** 当前生效的三档组合，写进每一行报告，避免 16 格混表后无法追溯 */
  const modeRef = useRef('合批 off · 阴影 on · 细节 auto');
  /** 组件是否仍在场：串行队列每跑一步先问它，离开页面 / StrictMode 双挂载的第一份不再继续喂场景 */
  const aliveRef = useRef(true);



  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('选择场景开始采样');
  const [live, setLive] = useState({
    components: 0,
    calls: 0,
    triangles: 0,
    fps: 0,
    buckets: 0,
    mode: '合批 off · 阴影 on · 细节 auto',
  });
  const [rows, setRows] = useState<ReportRow[]>([]);

  // 挂载 Viewport3D（StrictMode 双挂载由 dispose 兜底，与建模页 Viewport 同款）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    aliveRef.current = true; // StrictMode 双挂载：第一份的 cleanup 置过 false，这一份要复位
    const vp = new Viewport3D(el, {
      onSelectChange: () => {},
      onCursorMove: () => {},
      onZoom: () => {},
      onFps: (fps) => {
        // 500ms 采样回调：分入当前阶段样本桶 + 刷新实时面板
        const p = phaseRef.current;
        if (p === 'idle') idleSamplesRef.current.push(fps);
        else if (p === 'orbit') orbitSamplesRef.current.push(fps);
        const stats = vp.getRenderStats();
        setLive((s) => ({
          ...s,
          fps,
          calls: stats.calls,
          triangles: stats.triangles,
          buckets: vp.getBatchStats().buckets,
        }));
      },
    });
    vpRef.current = vp;
    // ?lod=near | far | auto：锁档跑基线，用来量出 T2.12 near 细节档的真实成本
    // （不锁档时由相机距离自动升降，基线数值会随取景远近漂移，不可跨环境比较）
    const q = new URLSearchParams(window.location.search);
    const lod = q.get('lod');
    if (lod === 'near' || lod === 'far' || lod === 'auto') vp.setLodPolicy(lod);
    // ?batch=on|off（T2.10g 实例化批渲染）：两档必须成对采样，才能证明「合批省下的 draw call」
    // 而不是只是「看起来一样」；?noshadow=1（T2.10a）同理给出开 / 关阴影两组数值。
    const batch = q.get('batch');
    if (batch === 'on' || batch === 'off') vp.setBatching(batch);
    if (q.get('noshadow') === '1') vp.setShadowMode('off');
    const mode =
      '合批 ' + vp.getBatching() + ' · 阴影 ' + vp.getShadowMode() + ' · 细节 ' + (lod ?? 'auto');
    modeRef.current = mode; // 报告行要落同一份档位串，不能只给页首回显看
    setLive((s) => ({ ...s, mode }));

    const timers = timersRef.current;
    return () => {
      vpRef.current = null;
      phaseRef.current = 'none';
      aliveRef.current = false; // 让在跑的串行队列就地止步
      runningRef.current = false;
      timers.forEach((t) => window.clearTimeout(t));
      timers.length = 0;
      vp.dispose();
    };

  }, []);
  /**
   * 执行一次场景：载入 → 静止采样 → 环绕采样 → 出报告。
   * 返回 `Promise<ReportRow>`（供 `?auto=all` 串行 await）；已有场景在跑时被拒则返回 null。
   * 互斥以 `runningRef` 为准而不是 `running` state：setState 异步，串行队列里连着调用
   * 会读到同一帧的旧值 ⇒ 第二个场景直接打断第一个的采样窗口，读数双双失真（v3.7 实测踩过）。
   */
  const runScenario = (sc: Scenario): Promise<ReportRow | null> => {
    const vp = vpRef.current;
    if (!vp || runningRef.current) return Promise.resolve(null);
    const { comps, types, cx, cz, extent } = sc.build();
    runningRef.current = true;
    vp.clear();
    for (const c of comps) {
      const type = types.get(c.typeId);
      if (type) vp.addOrUpdate(c, type);
    }
    vp.frameArea(cx, cz, extent);
    idleSamplesRef.current = [];
    orbitSamplesRef.current = [];
    setLive((s) => ({ ...s, components: comps.length }));
    setRunning(true);
    setStatus(`静止采样 · ${sc.label}（3s）…`);
    phaseRef.current = 'idle';
    return new Promise<ReportRow | null>((resolve) => {
      timersRef.current.push(
        window.setTimeout(() => {
          vp.setAutoRotate(true);
          phaseRef.current = 'orbit';
          setStatus(`环绕采样 · ${sc.label}（3s）…`);
          timersRef.current.push(
            window.setTimeout(() => {
              vp.setAutoRotate(false);
              phaseRef.current = 'none';
              runningRef.current = false;
              setRunning(false);
              const idle = idleSamplesRef.current;
              const orbit = orbitSamplesRef.current;
              const stats = vp.getRenderStats();
              const row: ReportRow = {
                scenario: sc.label,
                mode: modeRef.current,
                components: comps.length,
                calls: stats.calls,
                buckets: vp.getBatchStats().buckets,
                triangles: stats.triangles,
                idleMin: minOf(idle),
                idleAvg: avgOf(idle),
                orbitMin: minOf(orbit),
                orbitAvg: avgOf(orbit),
                verdict:
                  sc.target === null
                    ? '参考'
                    : minOf(orbit) >= sc.target
                      ? '达标'
                      : `未达标（目标 ${sc.target}fps）`,
              };
              setRows((rs) => [...rs, row]);
              setStatus('完成 · 可继续选择其它场景');
              console.table([row]); // 便于复制进开发计划基线记录
              resolve(row);
            }, PHASE_MS),
          );
        }, PHASE_MS),
      );
    });
  };

  /**
   * 串行跑一批场景（`?auto=all` 深链与「跑完四档」按钮共用同一条队列，避免两套语义漂移）。
   * 每步之前问 `aliveRef`：StrictMode 会让 effect 跑两遍，第一遍的 timer 虽被 clearTimeout
   * 掐掉，但 await 之后的代码不在 timer 里——没有这道检查就会有两份队列并行互踩采样窗口。
   * 返回 false = 中途止步（组件已卸载，或有别的场景正占着采样）。
   */
  const runQueue = async (list: Scenario[]): Promise<boolean> => {
    for (const sc of list) {
      if (!aliveRef.current) return false;
      const row = await runScenario(sc);
      if (row === null) return false; // 上一条还在跑（按钮与深链撞车）：让先到的那条走完
      // 场景之间留一拍：上一档收尾（关 autoRotate / 释放 shadow map）与下一档全量建几何
      // 挤进同一帧的话，静止阶段的头几个样本会同时吃到两件事的尾巴，min 值偏低。
      await new Promise<void>((r) => window.setTimeout(r, GAP_MS));
    }
    if (aliveRef.current) setStatus('全部场景采样完成 · 可复制或下载报告');
    return true;
  };

  // ?auto 深链（一键基线）：sample = 只跑黄金样例；all = 顺序跑完四档（v3.7 新增）。
  useEffect(() => {
    const auto = new URLSearchParams(window.location.search).get('auto');
    const list =
      auto === 'all'
        ? SCENARIOS
        : auto === 'sample'
          ? SCENARIOS.filter((s) => s.id === 'sample')
          : [];
    if (list.length === 0) return;
    const t = window.setTimeout(() => {
      void runQueue(list);
    }, 300);
    return () => window.clearTimeout(t);
    // runScenario / runQueue 依赖当帧状态，深链只触发一次，无需入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  /** 清表：16 格分四组 URL 跑，跑完一组复制走就要清，否则四组叠成一张 16 行长表 */
  const clearReport = () => {
    if (runningRef.current) return;
    setRows([]);
    setStatus('已清空 · 选择场景开始采样');
  };

  /** 复制为 Markdown：navigator.clipboard 在非安全上下文（内网 http 地址）不可用，必须留 execCommand 兜底 */
  const copyReport = async () => {
    if (rows.length === 0) return;
    const text = reportMarkdown(rows);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        legacyCopy(text);
      }
      toastSuccess(`已复制 ${rows.length} 行基线数据（Markdown 表格）`);
    } catch {
      try {
        legacyCopy(text);
        toastSuccess(`已复制 ${rows.length} 行基线数据（Markdown 表格）`);
      } catch {
        toastError('浏览器拒绝写入剪贴板，请改用「下载 CSV」');
      }
    }
  };

  /** 下载 CSV：走 io 层 toCsv（BOM + CRLF），Excel / WPS 打开中文表头不乱码 */
  const exportCsv = () => {
    if (rows.length === 0) return;
    const file = `ArchView-性能基线-${dateStamp()}.csv`;
    downloadTextFile(file, toCsv(REPORT_CSV_COLUMNS, rows), 'text/csv;charset=utf-8');
    toastSuccess(`已导出 ${file}`);
  };


  return (
    <div className="fps-page">
      <div ref={containerRef} className="fps-viewport" />
      <div className="fps-panel">
        <h1>性能基线（S2.0d / T3.6）</h1>
        <div className="fps-scenarios">
          {SCENARIOS.map((sc) => (
            <button
              key={sc.id}
              className="btn"
              disabled={running}
              title={`${sc.note}${sc.target === null ? '' : ` · 目标 ${sc.target}fps`}`}
              onClick={() => {
                void runScenario(sc);
              }}
            >
              {sc.label}（{sc.count}）
            </button>
          ))}
        </div>

        <div className="fps-live">
          {live.mode} · {status} · 组件 {live.components} · 绘制调用 {live.calls}
          {live.buckets > 0 ? ' · 实例桶 ' + live.buckets : ''} · 三角形{' '}
          {(live.triangles / 1000).toFixed(1)}k · 当前 {live.fps} fps
        </div>
        <div className="fps-actions">
          <button
            className="btn btn-primary"
            disabled={running}
            title="按本页 16 格测量 SOP 依次跑完四档（当前 URL 的 batch / noshadow / lod 参数保持不动）"
            onClick={() => {
              // 先清表再跑：四组 URL 各得一张干净的 4 行表，
              // 否则第二次跑完拿到的是 8 行混合表，抄 §S2.0d 时要自己拆——多一步就会抄错一行。
              setRows([]);
              void runQueue(SCENARIOS);
            }}

          >
            跑完四档
          </button>
          <button className="btn" disabled={rows.length === 0 || running} onClick={() => void copyReport()}>
            复制为 Markdown
          </button>
          <button className="btn" disabled={rows.length === 0 || running} onClick={exportCsv}>
            下载 CSV
          </button>
          <button className="btn btn-ghost" disabled={rows.length === 0 || running} onClick={clearReport}>
            清空
          </button>
        </div>
        {rows.length > 0 && (
          <table className="fps-table">
            <thead>
              <tr>
                {REPORT_COLUMNS.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.scenario}</td>
                  <td className="fps-mode">{r.mode}</td>
                  <td>{r.components}</td>
                  <td>{r.calls}</td>
                  <td>{r.buckets > 0 ? r.buckets : '—'}</td>
                  <td>{(r.triangles / 1000).toFixed(1)}k</td>
                  <td>
                    {r.idleMin} / {r.idleAvg}
                  </td>
                  <td>
                    {r.orbitMin} / {r.orbitAvg}
                  </td>
                  <td
                    className={
                      r.verdict === '达标'
                        ? 'fps-pass'
                        : r.verdict === '参考'
                          ? 'fps-ref'
                          : 'fps-fail'
                    }
                  >
                    {r.verdict}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="fps-note">
          目标（开发计划 §8）：M1 = 100 组件 @ 60fps；v1.0 = 1000 组件 @ 55fps；20×20 档按 M1 口径取 60fps（唯一吃满阴影视锥的一档）。
          采样 = 静止 3s + 环绕 3s（每 500ms 一个样本），判定以环绕阶段最小值为准；结果同步输出 console（console.table）。
          <br />
          <strong>16 格怎么跑</strong>：改 URL 参数开四组页签 ——
          <code>?auto=all&amp;batch=on</code> · <code>?auto=all&amp;batch=on&amp;noshadow=1</code> ·{' '}
          <code>?auto=all&amp;batch=off</code> · <code>?auto=all&amp;batch=off&amp;noshadow=1</code>，
          每组点「跑完四档」→「复制为 Markdown」→「清空」，四张表合起来就是 §S2.0d 的 16 格；
          别忘了把 GPU / DPR / 是否全屏记进环境列。
        </p>

        <Link to="/" className="fps-back">
          ← 返回工程列表
        </Link>
      </div>
    </div>
  );
}
