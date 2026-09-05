/**
 * 快捷键体系（T2.7 / §10.3 全套，以产品文档 §10.3 快捷键表为基准）：
 * - ./catalog  纯数据：ShortcutId + 帮助弹窗用的两张表；
 * - ./parse    纯函数：键位组合 → 动作 ID（可单测，无 DOM / store 依赖）；
 * - ./dispatch 动作分发：读 UI / Document store、调视口 API。
 *
 * 早期各任务（T1.6 / T2.2~T2.6）在 ProjectPage 的内联 if-else 里零散接快捷键，曾收口为单一入口；
 * Phase 6 再把「表 / 判定 / 执行」三层拆开——改文案不必重跑动作逻辑，加动作也不必读弹窗代码。
 */
export {
  MOUSE_GROUPS,
  SHORTCUT_GROUPS,
  type ShortcutEntry,
  type ShortcutGroup,
  type ShortcutId,
} from './catalog';
export { parseShortcut, presetOf } from './parse';
export { handleShortcut } from './dispatch';
