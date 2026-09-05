import * as THREE from 'three';

/**
 * 2D 覆盖层（T2.6 / 产品文档 §8.2-8）：视口内唯一的 2D 覆盖层 —— 单个 SVG 元素，
 * 承载框选橡皮筋 + 尺寸标注（选中组件 W×D 尺寸线、房间名称 + 尺寸）。
 * 纯 2D 覆盖层，不进入 three.js 场景图（避免双份数据源）；
 * 2D 模式下每帧由宿主直接驱动（DOM 直写，不走 React，与罗盘同一约定）。
 * 样式走 CSS 类（web styles/components.css，引用 @archview/theme token，禁硬编码）。
 */

/** 选中组件尺寸标注（世界坐标 mm；yawDeg = Y 轴偏航角，core.yawDegrees 输出） */
export interface ComponentAnnotation {
  id: string;
  x: number;
  z: number;
  yawDeg: number;
  /** 实例尺寸（size 单一事实源，§8.2-9） */
  w: number;
  d: number;
}

/** 房间标注（世界坐标 mm；房间轮廓在场景图内，标签在此覆盖层） */
export interface RoomAnnotation {
  id: string;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
}

const NS = 'http://www.w3.org/2000/svg';
/** 尺寸线距组件边缘的偏移（mm，世界空间：随缩放变化，CAD 约定） */
const DIM_OFFSET = 400;
/** 尺寸线两端刻度长度（mm） */
const DIM_TICK = 150;

/** 组件尺寸线节点池（固定结构：2 尺寸线 + 4 刻度 + 2 文本，避免每帧重建 DOM） */
interface DimNodes {
  wLine: SVGLineElement;
  dLine: SVGLineElement;
  wTicks: [SVGLineElement, SVGLineElement];
  dTicks: [SVGLineElement, SVGLineElement];
  wText: SVGTextElement;
  dText: SVGTextElement;
  key: string;
}

/** 房间标签节点池条目 */
interface RoomNode {
  g: SVGGElement;
  key: string;
}

export class Overlay2D {
  private readonly svg: SVGSVGElement;
  private readonly rubber: SVGRectElement;
  private readonly roomGroup: SVGGElement;
  private readonly dimGroup: SVGGElement;
  private readonly tmp = new THREE.Vector3();
  private size = { w: 1, h: 1 };
  private dim: DimNodes | null = null;
  private readonly roomNodes = new Map<string, RoomNode>();

  constructor(container: HTMLElement) {
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'vp-2d-overlay');
    this.svg.setAttribute('aria-hidden', 'true');

    this.rubber = document.createElementNS(NS, 'rect');
    this.rubber.setAttribute('class', 'vp-2d-rubber');
    this.rubber.style.display = 'none';

    this.roomGroup = document.createElementNS(NS, 'g');
    this.roomGroup.setAttribute('class', 'vp-2d-rooms');

    this.dimGroup = document.createElementNS(NS, 'g');
    this.dimGroup.setAttribute('class', 'vp-2d-dims');
    this.dimGroup.style.display = 'none';

    this.svg.append(this.rubber, this.roomGroup, this.dimGroup);
    // 追加在 canvas 之后：CSS 里 z-index 低于 HUD（--z-hud），高于 canvas
    container.appendChild(this.svg);
  }

  /** 尺寸同步（宿主 resize 时调用；SVG 坐标系 = 容器像素） */
  resize(w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    this.size = { w, h };
    this.svg.setAttribute('width', String(w));
    this.svg.setAttribute('height', String(h));
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }

  show(): void {
    this.svg.style.display = '';
  }

  hide(): void {
    this.svg.style.display = 'none';
  }

  /** 橡皮筋矩形（容器像素坐标；null = 收起） */
  setRubber(r: { x0: number; y0: number; x1: number; y1: number } | null): void {
    if (!r) {
      this.rubber.style.display = 'none';
      return;
    }
    this.rubber.style.display = '';
    const x = Math.min(r.x0, r.x1);
    const y = Math.min(r.y0, r.y1);
    this.rubber.setAttribute('x', x.toFixed(1));
    this.rubber.setAttribute('y', y.toFixed(1));
    this.rubber.setAttribute('width', Math.abs(r.x1 - r.x0).toFixed(1));
    this.rubber.setAttribute('height', Math.abs(r.y1 - r.y0).toFixed(1));
  }

  /**
   * 每帧更新（仅 2D 模式）：房间标签 + 选中组件尺寸标注。
   * 结构级变化（组件 / 房间集合变化）才重建节点，其余帧只更新坐标属性。
   */
  update(camera: THREE.Camera, comp: ComponentAnnotation | null, rooms: RoomAnnotation[]): void {
    this.updateRooms(camera, rooms);
    this.updateDim(camera, comp);
  }

  dispose(): void {
    this.svg.remove();
  }

  // ---------- 内部 ----------

  /** 世界 (x, z)（地面 y=0）→ 容器像素坐标 */
  private project(camera: THREE.Camera, x: number, z: number): { x: number; y: number } {
    const v = this.tmp.set(x, 0, z).project(camera);
    return {
      x: ((v.x + 1) / 2) * this.size.w,
      y: ((1 - v.y) / 2) * this.size.h,
    };
  }

  /** 房间标签池对账（id 增删 / 名称尺寸变化重建文本，其余帧只更新 transform） */
  private updateRooms(camera: THREE.Camera, rooms: RoomAnnotation[]): void {
    const seen = new Set<string>();
    for (const r of rooms) {
      seen.add(r.id);
      const key = `${r.name}|${r.width}|${r.depth}`;
      let node = this.roomNodes.get(r.id);
      if (!node || node.key !== key) {
        if (node) node.g.remove();
        node = this.buildRoomLabel(r);
        this.roomNodes.set(r.id, node);
        this.roomGroup.appendChild(node.g);
      }
      const p = this.project(camera, r.x, r.z);
      node.g.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
    }
    for (const [id, node] of [...this.roomNodes]) {
      if (!seen.has(id)) {
        node.g.remove();
        this.roomNodes.delete(id);
      }
    }
  }

  private buildRoomLabel(r: RoomAnnotation): RoomNode {
    const g = document.createElementNS(NS, 'g');
    const nameEl = document.createElementNS(NS, 'text');
    nameEl.setAttribute('class', 'vp-2d-room-name');
    nameEl.setAttribute('y', '-6');
    nameEl.textContent = r.name;
    const sizeEl = document.createElementNS(NS, 'text');
    sizeEl.setAttribute('class', 'vp-2d-room-size');
    sizeEl.setAttribute('y', '12');
    sizeEl.textContent = `${r.width} × ${r.depth}`;
    g.append(nameEl, sizeEl);
    return { g, key: `${r.name}|${r.width}|${r.depth}` };
  }

  /** 选中组件尺寸标注：W 尺寸线（组件局部 +Z 外侧）+ D 尺寸线（局部 -X 外侧），文本保持屏幕水平 */
  private updateDim(camera: THREE.Camera, comp: ComponentAnnotation | null): void {
    if (!comp) {
      if (this.dim) {
        this.dimGroup.style.display = 'none';
        this.dim = null;
      }
      return;
    }
    const key = `${comp.id}|${comp.w}|${comp.d}`;
    if (!this.dim || this.dim.key !== key) {
      this.dim = this.buildDim(comp, key);
      this.dimGroup.replaceChildren(
        this.dim.wLine,
        this.dim.dLine,
        this.dim.wTicks[0],
        this.dim.wTicks[1],
        this.dim.dTicks[0],
        this.dim.dTicks[1],
        this.dim.wText,
        this.dim.dText,
      );
    }
    this.dimGroup.style.display = '';
    const n = this.dim;
    const rad = (comp.yawDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    /** 组件局部坐标 (lx, lz) → 世界 → 屏幕像素（Y 轴偏航：局部 +X → 世界 (cos, -sin)，+Z → (sin, cos)） */
    const p = (lx: number, lz: number) =>
      this.project(camera, comp.x + lx * cos + lz * sin, comp.z - lx * sin + lz * cos);

    // W 尺寸线（局部 +Z 侧，偏移 DIM_OFFSET）
    const w0 = p(-comp.w / 2, comp.d / 2 + DIM_OFFSET);
    const w1 = p(comp.w / 2, comp.d / 2 + DIM_OFFSET);
    this.setLine(n.wLine, w0, w1);
    this.setLine(
      n.wTicks[0],
      p(-comp.w / 2, comp.d / 2 + DIM_OFFSET - DIM_TICK / 2),
      p(-comp.w / 2, comp.d / 2 + DIM_OFFSET + DIM_TICK / 2),
    );
    this.setLine(
      n.wTicks[1],
      p(comp.w / 2, comp.d / 2 + DIM_OFFSET - DIM_TICK / 2),
      p(comp.w / 2, comp.d / 2 + DIM_OFFSET + DIM_TICK / 2),
    );
    this.setText(n.wText, (w0.x + w1.x) / 2, (w0.y + w1.y) / 2 - 7, String(comp.w));

    // D 尺寸线（局部 -X 侧）
    const d0 = p(-comp.w / 2 - DIM_OFFSET, -comp.d / 2);
    const d1 = p(-comp.w / 2 - DIM_OFFSET, comp.d / 2);
    this.setLine(n.dLine, d0, d1);
    this.setLine(
      n.dTicks[0],
      p(-comp.w / 2 - DIM_OFFSET - DIM_TICK / 2, -comp.d / 2),
      p(-comp.w / 2 - DIM_OFFSET + DIM_TICK / 2, -comp.d / 2),
    );
    this.setLine(
      n.dTicks[1],
      p(-comp.w / 2 - DIM_OFFSET - DIM_TICK / 2, comp.d / 2),
      p(-comp.w / 2 - DIM_OFFSET + DIM_TICK / 2, comp.d / 2),
    );
    this.setText(n.dText, (d0.x + d1.x) / 2 - 7, (d0.y + d1.y) / 2, String(comp.d));
  }

  private buildDim(comp: ComponentAnnotation, key: string): DimNodes {
    const mkLine = (): SVGLineElement => {
      const el = document.createElementNS(NS, 'line') as SVGLineElement;
      el.setAttribute('class', 'vp-2d-dim-line');
      return el;
    };
    const mkTick = (): SVGLineElement => {
      const el = document.createElementNS(NS, 'line') as SVGLineElement;
      el.setAttribute('class', 'vp-2d-dim-tick');
      return el;
    };
    const mkText = (): SVGTextElement => {
      const el = document.createElementNS(NS, 'text') as SVGTextElement;
      el.setAttribute('class', 'vp-2d-dim-text');
      el.textContent = String(comp.w); // 占位，updateDim 每帧按 W/D 分别写入
      return el;
    };
    return {
      key,
      wLine: mkLine(),
      dLine: mkLine(),
      wTicks: [mkTick(), mkTick()],
      dTicks: [mkTick(), mkTick()],
      wText: mkText(),
      dText: mkText(),
    };
  }

  private setLine(el: SVGLineElement, a: { x: number; y: number }, b: { x: number; y: number }): void {
    el.setAttribute('x1', a.x.toFixed(1));
    el.setAttribute('y1', a.y.toFixed(1));
    el.setAttribute('x2', b.x.toFixed(1));
    el.setAttribute('y2', b.y.toFixed(1));
  }

  private setText(el: SVGTextElement, x: number, y: number, content: string): void {
    el.setAttribute('x', x.toFixed(1));
    el.setAttribute('y', y.toFixed(1));
    if (el.textContent !== content) el.textContent = content;
  }
}
