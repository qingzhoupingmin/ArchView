// 测试前置：
// 1) 最先导入 reflect-metadata（Nest DI 的 @Inject 参数元数据依赖 Reflect polyfill，
//    必须在任何 Nest 模块求值前加载）
// 2) 加载仓库根 .env（DATABASE_URL / JWT_SECRET），保证 PrismaClient 可用
import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerDtoMetadata } from '../src/common/dto-metadata';

// vitest 以 packages/api 为 cwd 运行 → 上两级即仓库根（用 process.cwd() 避免 import.meta 与 CJS 类型冲突）
const rootEnv = join(process.cwd(), '..', '..', '.env');

if (existsSync(rootEnv)) {
  for (const line of readFileSync(rootEnv, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

// esbuild 系转译（vitest）不发射 design:paramtypes → 补齐 DTO 校验元数据（与 main.ts 相同处理）
registerDtoMetadata();
