let seq = 0;

/**
 * 轻量唯一 ID（无外部依赖；工程文件 / 组件 / 机房统一使用）。
 * 格式：前缀_时间戳36_序号_随机段，可读且碰撞概率极低。
 */
export function uid(prefix = 'id'): string {
  seq = (seq + 1) % 1296;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36).padStart(2, '0')}_${rand}`;
}
