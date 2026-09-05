// Vitest 根配置：统一覆盖 packages / apps 的单测（覆盖率要求见开发计划 §7.2）
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // 注意：更具体的前缀必须放在前面（alias 为前缀匹配）
      '@archview/theme/tokens.css': src('./packages/theme/src/tokens.css'),
      '@archview/theme': src('./packages/theme/src'),
      '@archview/core': src('./packages/core/src'),
      '@archview/renderer': src('./packages/renderer/src'),
      '@archview/component-lib': src('./packages/component-lib/src'),
      '@archview/ui': src('./packages/ui/src'),
      '@archview/io': src('./packages/io/src'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}', 'apps/*/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // P0 初期暂无用例时不报错（api 集成测试由 packages/api 的独立 vitest 运行）
    passWithNoTests: true,
  },
});
