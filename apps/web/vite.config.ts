import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// 应用版本号：构建期通过 define 注入（登录页底部署名展示，避免硬编码字符串）
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      // 注意：更具体的前缀必须放在前面（alias 为前缀匹配）
      '@archview/theme/tokens.css': dir('../../packages/theme/src/tokens.css'),
      '@archview/theme': dir('../../packages/theme/src'),
      '@archview/core': dir('../../packages/core/src'),
      '@archview/renderer': dir('../../packages/renderer/src'),
      '@archview/component-lib': dir('../../packages/component-lib/src'),
      '@archview/ui': dir('../../packages/ui/src'),
      '@archview/io': dir('../../packages/io/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 开发期将 /api 请求代理到后端（端口 3007）
      '/api': { target: 'http://localhost:3007', changeOrigin: true },
    },
  },
  preview: {
    // pnpm preview（4173）同样代理 /api，否则相对路径 /api/v1 会 404（控制台 Failed to load resource）
    proxy: {
      '/api': { target: 'http://localhost:3007', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
