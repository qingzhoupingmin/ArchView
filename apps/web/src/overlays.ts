/**
 * 浮层注册表（T2.7 / §10.3「Esc = 取消选择 / 关闭弹窗」语义统一）：
 * 浮层（弹窗 / 2D 右键菜单）打开期间，Esc 应只关闭浮层、不清空选择集。
 * 模块级引用计数（非 React 状态）：浮层打开时 register / 关闭时 unregister（effect 清理），
 * 全局快捷键层（shortcuts.ts 的 Esc 分支）查 hasOverlay() 决定是否让位。
 * 引用计数而非布尔：多个浮层同时打开时（极端情况：右键菜单 + 弹窗叠加）要全部关闭才放行。
 */
let overlayCount = 0;

/** 注册一个已打开的浮层（在浮层打开的 effect 中调用） */
export function registerOverlay(): void {
  overlayCount += 1;
}

/** 注销一个已关闭的浮层（与 registerOverlay 成对，在 effect 清理中调用） */
export function unregisterOverlay(): void {
  if (overlayCount > 0) overlayCount -= 1;
}

/** 是否有浮层打开（有则 Esc 交由浮层自身的关闭处理器，不碰选择集） */
export function hasOverlay(): boolean {
  return overlayCount > 0;
}