/**
 * 共享资源工厂（架构拆分 Phase 3，自 `viewport.ts` 逐字迁出）
 *
 * 定位：**内核级服务**——它不持有场景、不认得选择集，只负责「同一份几何 / 同一份材质
 * 在全场景只存在一份」。因此允许被任何协作者依赖（见 eslint.config.mjs 依赖方向护栏说明）。
 *
 * 两条必须守住的旧约定：
 * - 几何按 `kind|尺寸` 跨实例共享 ⇒ **共享几何绝不随单个组件 dispose**（T2.10f 的老坑，
 *   删一个组件会连带毁掉同型所有实例的几何）；统一在本层 `dispose()` 里、视口销毁的最后一步释放。
 * - 共享只省显存与重建开销，**不会减少 draw call**（那是实例化的职责，T2.10g）。
 */
import * as THREE from 'three';
import {
  tintPrimColor,
  typeSwatchColor,
  type Component,
  type ComponentType,
  type GeometryPrimitive,
  type MaterialSlot,
} from '@archview/core';
import { MAT_PRESETS, VP_COMPONENT_DEFAULT } from '@archview/theme';

/**
 * 图元显示色（S2.5 / T2.10d + T2.11，产品文档 §10.4）：
 * 实例色经 **tint 调制** → 逐图元 color → 主题默认灰。
 * 旧实现只读 `geometry[0].color`，其余图元的色声明形同虚设（多材质素材无法表达）；
 * 而 T2.11 前「实例色直接覆盖全部图元」又会让精修的部件层次被一支色抹平，
 * 故实例色改作底色、按图元相对代表色的明度比调制（`tintPrimColor`，FR-D01 与 FR-V06 两全）。
 */
export function primColorOf(
  comp: Component,
  prim: GeometryPrimitive,
  type: ComponentType,
): string {
  if (comp.color) {
    return tintPrimColor(comp.color, prim.color, typeSwatchColor(type)) ?? comp.color;
  }
  return prim.color ?? VP_COMPONENT_DEFAULT;
}

/** 材质桶键：同「档位 + 颜色 + 双面口径」共用一个材质实例（少一次 uniform 切换与着色器重编译） */
function matKey(slot: MaterialSlot, color: string, doubleSide: boolean): string {
  return `${slot}|${color}${doubleSide ? '|ds' : ''}`;
}

export class AssetRegistry {
  /** 图元几何缓存（S2.5 / T2.10f）：键 = kind|尺寸，跨实例共享 BufferGeometry */
  private readonly geoCache = new Map<string, THREE.BufferGeometry>();

  /** 几何缓存键：同 kind 同尺寸 = 同一份 BufferGeometry（跨实例、跨组件共享） */
  private geoKey(prim: GeometryPrimitive): string {
    if (prim.kind === 'cylinder') return `c|${prim.size[0]}|${prim.size[1]}`;
    if (prim.kind === 'plane') return `p|${prim.size[0]}|${prim.size[1]}`;
    if (prim.kind === 'sphere') return `s|${prim.size[0]}`;
    if (prim.kind === 'cone') return `k|${prim.size[0]}|${prim.size[1]}`;
    return `b|${prim.size[0]}|${prim.size[1]}|${prim.size[2]}`;
  }

  /**
   * 取图元几何（T2.10f）：命中缓存即共享。**共享几何不得随实例 dispose**
   * ——统一由 dispose() 在整个视口销毁时释放，否则删一个组件会连带毁掉同型所有实例的几何。
   */
  geometryOf(prim: GeometryPrimitive): THREE.BufferGeometry {
    const key = this.geoKey(prim);
    const cached = this.geoCache.get(key);
    if (cached) return cached;
    let geo: THREE.BufferGeometry;
    if (prim.kind === 'cylinder') {
      const [r, h] = prim.size;
      geo = new THREE.CylinderGeometry(r, r, h, 24);
    } else if (prim.kind === 'plane') {
      const [w, d] = prim.size;
      geo = new THREE.PlaneGeometry(w, d);
    } else if (prim.kind === 'sphere') {
      // 分段参数 24×16 与 core primTriangleCount 的 720 面口径绑定（assets.test.ts 锁死）
      const [r] = prim.size;
      geo = new THREE.SphereGeometry(r, 24, 16);
    } else if (prim.kind === 'cone') {
      const [r, h] = prim.size;
      geo = new THREE.ConeGeometry(r, h, 24);
    } else {
      const [w, h, d] = prim.size;
      geo = new THREE.BoxGeometry(w, h, d);
    }
    this.geoCache.set(key, geo);
    return geo;
  }

  /**
   * 取（或建）图元材质（T2.10d）：按「档位 + 颜色」分桶复用。
   * `matte` 缺省档的参数刻意等于旧实现，旧素材零视觉回归；`emissive` 档自发光色取图元色。
   * 桶由调用方（组件条目）持有，本层只负责造——材质生命周期归条目自己。
   */
  makeMaterial(
    bucket: Map<string, THREE.MeshStandardMaterial>,
    prim: GeometryPrimitive,
    comp: Component,
    type: ComponentType,
  ): THREE.MeshStandardMaterial {
    const slot: MaterialSlot = prim.material ?? 'matte';
    const color = primColorOf(comp, prim, type);
    const doubleSide = prim.kind === 'plane';
    const key = matKey(slot, color, doubleSide);
    const cached = bucket.get(key);
    if (cached) return cached;
    const p = MAT_PRESETS[slot];
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: p.roughness,
      metalness: p.metalness,
    });
    if (doubleSide) {
      // 零厚度屏面 / 玻璃面板：FrontSide 在背面视角会整面消失（通道封闭板 / 电视背面）
      mat.side = THREE.DoubleSide;
    }
    if (p.opacity < 1) {
      mat.transparent = true;
      mat.opacity = p.opacity;
      // 半透明件不写深度：浅色视口里避免自身面片互相穿帮（玻璃门 / 网孔板）
      mat.depthWrite = false;
    }
    if (p.emissive > 0) {
      mat.emissive = new THREE.Color(color);
      mat.emissiveIntensity = p.emissive;
    }
    bucket.set(key, mat);
    return mat;
  }

  /** 到此刻才释放共享几何（T2.10f：实例删除只摘节点，几何由本层统一回收） */
  dispose(): void {
    for (const geo of this.geoCache.values()) geo.dispose();
    this.geoCache.clear();
  }
}