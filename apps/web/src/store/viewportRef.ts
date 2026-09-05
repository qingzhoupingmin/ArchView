import type { Viewport3D } from '@archview/renderer';

/**
 * Viewport3D 实例的非响应式引用（P2）：状态栏缩放按钮 / 视口 HUD 需要调用相机 API，
 * 但实例本身不应进入 React 状态（否则每帧回调会带着整棵组件树重渲染）。
 */
export const viewportRef: { current: Viewport3D | null } = { current: null };
