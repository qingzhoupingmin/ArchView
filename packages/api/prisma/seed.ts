/**
 * 种子数据（T0.8 / M0）：幂等创建超管账号。
 * 用户名：admin；密码：环境变量 SEED_ADMIN_PASSWORD 或预置 admin123（控制台输出）。
 * 幂等策略：不存在 → 创建；已存在但未自定义密码（mustChangePassword=true）→ 重置为预置密码并清除该标记；
 * 已自定义过密码 → 不覆盖（避免重置用户已改的密码）。
 * 说明：FR-U02 的首登强制改密针对「超管新建的用户」与「被管理员重置密码的用户」；种子超管
 * 不再打强制改密标记，admin / admin123 登录后可直接进入工程列表。
 */
import 'reflect-metadata';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'admin123';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const existing = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (!existing) {
    await prisma.user.create({
      data: {
        username: 'admin',
        nickname: '超级管理员',
        role: 'super_admin',
        email: 'admin@archview.local',
        passwordHash,
        mustChangePassword: false,
      },
    });
  } else if (existing.mustChangePassword) {
    // 尚未自定义密码 → 重置为预置密码并清除强制改密标记（保证 pnpm db:setup 可重复执行且能直接登录）
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, mustChangePassword: false },
    });
  }

  const seeded = !existing || existing.mustChangePassword;
  console.log('[seed] 超管账号就绪');
  console.log('  用户名: admin');
  console.log(`  密码:   ${password}`);
  if (!seeded) {
    console.log('  提示: 该账号已自定义密码，种子脚本未覆盖');
  }
}

main()
  .catch((e) => {
    console.error('[seed] 失败:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
