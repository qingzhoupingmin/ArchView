// api 包独立 Vitest 配置（依赖解析以 packages/api 为根，避免 pnpm 严格布局下的根解析问题）
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // NestJS 使用实验性装饰器，需显式让 esbuild 按旧版语义转换。
  // 注意：esbuild 不发射 design:paramtypes（官方文档标注 emitDecoratorMetadata 不受支持），
  // DTO 校验元数据由 test/setup.ts 的 registerDtoMetadata() 显式补齐（见 validation.test.ts）
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
      },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    environment: 'node',
    testTimeout: 30000,
    // 测试共享同一 dev SQLite（packages/data/archview.db）：文件间串行避免竞争
    fileParallelism: false,
  },
});

