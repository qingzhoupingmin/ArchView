// ArchView ESLint 9 flat config（lint 为 pnpm check 质量门禁的一部分，见开发计划 §7.1）
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      'coverage/**',
      'data/**',
      // 一次性调试产物目录：与 .gitignore 的 `.tmp/`（任意层级）保持同一口径
      '**/.tmp/**',
      '.tmp/**',
      'pnpm-lock.yaml',
    ],
  },
  {
    // Node 侧脚本（.js/.mjs，如部署脚本 / commitlint 配置）
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{jsx,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // 自定义 Hook 抽到 .ts 文件后也必须吃 hooks 规则（视口拆分 Phase 5：useViewportBridge 等）——
    // 否则「把 effect 从组件搬进 hook」会顺手把 React 依赖检查也搬丢了。
    files: ['apps/web/src/hooks/**/*.ts'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // ============================================================
  // 架构护栏（Viewport3D 模块拆分 Phase 0）
  // 目的：拆完不许再长回一只 2500 行的上帝类——行数预算 + 协作者依赖方向双重锁。
  // 口径：skipBlankLines / skipComments = true，只算「真正的代码量」，注释多不背锅。
  // 下面 DEBT OVERRIDES 是待收口的存量，每完成一个 Phase 就下调一档，
  // 全部拆完后整块 override 应当被删除——债还得干不干净，diff 里一眼看得见。
  // ============================================================
  {
    files: ['packages/renderer/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // 协作者之间禁止横向 import：一切跨块能力必须经 kernel / 门面编排传递。
    // 门面 viewport.ts 是唯一的装配者，允许依赖全部协作者，故不在本规则范围内。
    // ⚠️ 新增协作者模块时要把它的文件名登记进 group，否则拦不住。
    // 例外：./assets（AssetRegistry 无场景状态的资源工厂）与 ./types / ./constants / ./picking
    //       属「内核级」共享件，任何协作者都可直接依赖。
    files: ['packages/renderer/src/viewport/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                './camera-rig',
                './site-grid',
                './entry-store',
                './lod-controller',
                './room-layer',
                './selection',
                './interaction',
              ],
              message:
                'viewport 协作者不得横向依赖彼此（跨块能力请经 ViewportKernel 传递，或由门面 Viewport3D 编排）。',
            },
          ],
        },
      ],
    },
  },
  {
    // DEBT OVERRIDES · 存量待收口（Phase 4 后：RoomLayer 与 InteractionManager 已出，973 → 596）
    // 门面留的是「装配 + 帧编排 + 跨块一致性」，本就该比协作者厚一档；拆完再评估是否并回 400 预算。
    files: ['packages/renderer/src/viewport.ts'],
    rules: {
      'max-lines': ['error', { max: 620, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // 应用层同口径：组件文件 450 行为预算（Phase 5 起 Viewport.tsx 已降到 200 行以内）
    files: ['apps/web/src/**/*.tsx', 'packages/ui/src/**/*.tsx', 'packages/ui/src/**/*.ts'],
    ignores: ['**/*.test.tsx', '**/*.test.ts'],
    rules: {
      'max-lines': ['error', { max: 450, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // DEBT OVERRIDES · Phase 6 待拆的存量页面（ProjectsPage：三个弹窗尚未出户）
    files: ['apps/web/src/pages/ProjectsPage.tsx'],
    rules: {
      'max-lines': ['error', { max: 480, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // 部署辅助脚本（scripts/deploy/*.cjs）按 CJS 交付到服务器 api 包内执行 —— 那里不是
    // type:module，且必须用 require.resolve('@prisma/client') 反查「运行时真正加载的那个
    // 副本」（pnpm 自包含包里有多个同名目录，猜路径会改到没被加载的那份）。
    // 这是它们能工作的前提，故关掉该规则，而不是改写成 ESM 去赌解析。
    files: ['scripts/deploy/**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  prettier,
);
