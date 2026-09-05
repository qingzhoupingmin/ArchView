# ArchView

> 面向数据机房的开源 Web 三维建模与数字孪生可视化工具 · 粉白轻盈风格

**ArchView** 让机房三维化「像画平面图一样简单」：组件化精确建模 + 粉白轻盈视觉 + 电力/制冷/U 位分析。
产品需求与执行计划见内部工作文档（不随开源仓分发），公开口径以本 README 为准。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 语言 | TypeScript 5（strict） |
| 前端 | React 18 + Vite 5 + three.js + Zustand |
| 后端 | NestJS 10 + Prisma 5 |
| 数据库 | SQLite（文件存储，零安装零配置） |
| Monorepo | pnpm workspaces + turborepo |
| 质量门禁 | ESLint + Prettier + Vitest（本地 `pnpm check` 替代 CI，暂不做 CI/CD） |

## 快速开始

环境要求：Node.js ≥ 20.11（已在 Node 24 验证）· pnpm 9.x · 无需安装数据库。

```bash
pnpm install
pnpm db:setup   # 建表 + 迁移 + 种子超管账号（密码见控制台输出；首次运行会自动从 .env.example 生成根 .env）
pnpm dev        # 并发启动 web(5173) + api(3007)，HMR
```

浏览器打开 http://localhost:5173 ，使用种子超管登录：**默认账号 `admin` / 默认密码 `admin123`**（可在根 `.env` 用 `SEED_ADMIN_PASSWORD` 覆盖）。

## 常用脚本

| 脚本 | 说明 |
| --- | --- |
| `pnpm dev` | 并发启动 web + api（concurrently，HMR） |
| `pnpm build` | 全量构建（turborepo 缓存） |
| `pnpm test` / `pnpm test:watch` | 单元测试（Vitest） |
| `pnpm check` | 一键质量检查：lint + typecheck + 单测 + build |
| `pnpm check:components` | 只跑内置组件素材闸门（`far` 档预算 / 材质档 / 子部件名 / 安装高度与阴影口径）——**只改 `components.json` 加组件时先跑这条**，秒级出结果（社区贡献者只改素材时的快速自检） |
| `pnpm db:setup` | 建表 + 迁移 + 种子数据 |
| `pnpm start:all` | 类生产启动（node api + 静态 web；**需先 `pnpm build`**，api 跑 `dist/main.js`、web 为静态预览） |
| `pnpm deploy:server` | 一键部署到自托管服务器：**含数据库迁移与服务端 Prisma Client 同步**，可先 `-- --dry-run` 预览，详见下方「部署」 |
| `pnpm lint` / `pnpm format` | ESLint 检查 / Prettier 格式化 |
| `pnpm brand:favicon` | 改完品牌图形后重新生成页签位图（`favicon.ico` / `png`，几何真源 `apps/web/public/favicon.svg`） |

### 部署（`pnpm deploy:server`）

流程：本地构建 + `prisma generate` + **版本标记校准** → 远端 `.env` 密钥前置检查 → **停服 → 备份 SQLite → 拉副本到本地跑 `prisma migrate deploy` → 复核 → 回传** → 刷新服务端预生成 Prisma Client → 旁路上传 `dist.new` / `archview.new` → **启动前「客户端 ↔ 库 ↔ 迁移账本」三方自检** → 改名换入 + 起服 → **版本核对（基准 = 当前提交）** + HTTP 探活。

- 服务器上的 `node_modules` 是 `pnpm deploy --prod` 的自包含产物：**没有 prisma CLI**，所以迁移只能在本地对副本执行；只换 `dist` 也不会带上新模型的 `@prisma/client`（曾因此线上 `prisma.auditLog === undefined`）。这两件事现在都由脚本自动完成。
- 无待应用迁移时**不回传库文件**（线上库零写入风险）；迁移撞上「对象已存在但账本没记」的历史漂移时，只对这一类冲突自动补记账（`migrate resolve --applied`），其它错误一律中止。
- **版本核对以当前提交为基准**：`pnpm build` 走 turbo，api 输入未变时 `api:build` 整步被缓存命中跳过、`dist/version.json` 会停在旧 sha（旧比对拿本地文件比远端文件，两边同源必等 = 假绿）。现在构建后无条件重跑 `packages/api/scripts/write-version.mjs` 校准标记，并要求远端标记 == 当次提交；工作区不干净时标记写成 `<sha>-dirty`，热修上线也看得见。
- 可选参数：`--dry-run`（只打印）、`--skip-build`、`--no-restart`、`--no-db`（纯前端热修，跳过停服/迁移/客户端同步）、`--no-auto-resolve`（禁止补记账，失败即中止）。
- 环境变量：`DEPLOY_HOST` **必填**（目标服务器地址，如 Tailscale IP；开源整备后不再把作者内网地址写死为默认值），`DEPLOY_USER` / `DEPLOY_API_DIR` / `DEPLOY_WEB_DIR` / `DEPLOY_ENV_FILE` 可选（完整清单见 `scripts/deploy/server.mjs` 头部注释）。
- 想单独演练迁移逻辑（不碰服务器）：`node scripts/deploy/migrate-copy.mjs <本地库副本路径>`。
- 失败时脚本会打印回滚线索（本次生成的 `.bak` 位置、`*.old.rolling` 目录、`net start svc-node`）。

## 目录结构

```
ArchView/
├─ packages/
│  ├─ core/            # 纯 TS 领域层：document / types / command / 撤销重做
│  ├─ renderer/        # three.js 渲染层：场景 / 视口 / 拾取 / 2D 覆盖层
│  ├─ ui/              # React 组件：工具栏 / 组件库 / 属性面板 / 统计面板
│  ├─ io/              # JSON / glTF / CSV / IndexedDB / 截图
│  ├─ component-lib/   # 内置组件类型定义（JSON + 几何描述）
│  ├─ theme/           # 粉白主题 token（CSS 变量 + TS 常量）
│  └─ api/             # 后端服务（NestJS：auth / users / projects）
├─ apps/
│  └─ web/             # 主应用（Vite + React）
├─ scripts/             # 部署 / 品牌图标生成等脚本
└─ data/                # SQLite 数据目录（gitignore）
```

## 许可

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](./LICENSE)

本项目采用 [AGPL-3.0](./LICENSE) 许可协议（强 copyleft：网络服务视同分发）。
