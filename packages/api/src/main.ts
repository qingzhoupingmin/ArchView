import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AppModule } from './app.module';
import { registerDtoMetadata } from './common/dto-metadata';

/**
 * API 入口（T0.7）：/api/v1 前缀 + 全局校验管道 + 统一错误格式（§8.4）+ CORS。
 *
 * 标准做法：API 同端口托管前端静态构建（同端口免跨域）：
 * - WEB_ROOT 指向 web 构建目录；未设置时默认 monorepo 的 apps/web/dist（pnpm start:all 可用）；
 * - 开发模式下构建目录不存在则跳过静态托管（前端走 vite dev server 5173）。
 */
async function bootstrap() {
  // esbuild 系转译（tsx dev）不发射 design:paramtypes，显式补齐 DTO 校验元数据
  registerDtoMetadata();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // 反代（IIS :80 / Tailscale Serve :443 → 3007）下 req.ip 默认全是代理机地址，
  // 批次 D 的登录锁定按 IP 计数、审计要记来源 IP，都依赖还原后的真实客户端 IP。
  app.set('trust proxy', 1);
  // 工程 JSON 单包上限（批次 D / S5 加固）：先由 body parser 挡掉超大请求，
  // 业务侧 projects.service 再按 16MB 给可读文案（413）。
  app.useBodyParser('json', { limit: '24mb' });

  const corsOrigin = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigin, credentials: true });

  // 前端静态资源 + SPA history 回退：/ → index.html；未命中的前端路由 → index.html（客户端路由接管）
  const webRoot = process.env.WEB_ROOT ?? resolve(process.cwd(), '..', '..', 'apps', 'web', 'dist');
  if (existsSync(join(webRoot, 'index.html'))) {
    app.useStaticAssets(webRoot);
    app.use((req: Request, res: Response, next: NextFunction) => {
      const isApi = req.path.startsWith('/api/');
      const isFile = req.path.includes('.');
      if (req.method === 'GET' && !isApi && !isFile && req.accepts('html')) {
        res.sendFile(join(webRoot, 'index.html'));
        return;
      }
      next();
    });
    console.log(`[api] Web root: ${webRoot}`);
  } else {
    console.log(`[api] WEB_ROOT ${webRoot} 不存在，跳过静态托管（开发模式请用 vite dev server）`);
  }

  const port = Number(process.env.PORT ?? 3007);
  await app.listen(port);
  console.log(`[api] ArchView API listening on http://localhost:${port}/api/v1`);
}

void bootstrap();

