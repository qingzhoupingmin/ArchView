import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

const logger = new Logger('env');

/** 仓库 .env.example 里的占位值：与它相同一律视为「没配」 */
export const DEV_JWT_SECRET = 'dev-jwt-secret';
/** JWT 密钥最小长度（HS256 建议 ≥ 32 字节熵） */
const MIN_SECRET_LENGTH = 32;

/**
 * JWT 密钥校验（数据隔离专项·批次 D / S6）。
 *
 * 旧实现 `config.get('JWT_SECRET') ?? 'dev-jwt-secret'` 的兜底是个**静默的越权后门**：
 * 生产环境漏配 JWT_SECRET 时服务照常启动、日志毫无异常，而任何人只要读过仓库
 * 就能用公开的 'dev-jwt-secret' 自签一枚 `sub = 任意用户 ID` 的令牌，直接接管该账号
 * 的全部工程 —— 整套账号隔离瞬间归零。故生产缺配必须拒绝启动。
 */
export function resolveJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  const isProd = process.env.NODE_ENV === 'production';

  if (!secret || secret === DEV_JWT_SECRET || secret.length < MIN_SECRET_LENGTH) {
    if (isProd) {
      throw new Error(
        `[env] 生产环境必须配置 JWT_SECRET：非空、不等于 .env.example 占位值、长度 ≥ ${MIN_SECRET_LENGTH}。` +
          '（当前缺失或不合规 —— 用公开占位值签名等于任何人都能伪造任意账号令牌）',
      );
    }
    logger.warn(
      `JWT_SECRET 缺失 / 过短 / 仍是占位值，本地开发回退到 "${DEV_JWT_SECRET}"；严禁用于生产。`,
    );
    return DEV_JWT_SECRET;
  }
  return secret;
}
