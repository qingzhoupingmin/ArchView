/** 构建期注入的全局常量（见 apps/web/vite.config.ts 的 define） */
declare const __APP_VERSION__: string;

/**
 * Vite 构建期环境变量（与 vite/types/importMeta.d.ts 的 ImportMetaEnv 声明合并）。
 * 注意：Vite 只从 envDir（本仓库为 apps/web）下的 .env 读取，仓库根 .env 不会注入前端构建。
 */
interface ImportMetaEnv {
  /** 覆盖 API 基址（默认不设 → 前端按页面 origin 自动判定同源 / 跨端口）；示例：http://10.0.0.5:3007/api/v1 */
  readonly VITE_API_BASE?: string;
}
