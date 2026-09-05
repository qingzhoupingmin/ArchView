/**
 * Auth API 集成测试（T0.8 / M0 验收：种子超管登录、JWT、无感刷新）。
 * 依赖：先执行 pnpm db:setup（迁移 + 种子超管 admin）。
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';

const ADMIN = { username: 'admin', password: 'admin123' };

describe('Auth API（FR-U01 / U03 / U06）', () => {
  let app: INestApplication;
  // Nest 10 无 app.inject()，使用 supertest(app.getHttpServer())
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    // 测试隔离：dev / 测试共用同一 SQLite，且 seed upsert 幂等（update: {} 不重置状态），
    // 直接重置 admin 到种子初态（密码 + 首登强制改密标记），保证 mustChangePassword 断言成立
    const prisma = new PrismaClient();
    const hash = await argon2.hash(ADMIN.password, { type: argon2.argon2id });
    await prisma.user.upsert({
      where: { username: 'admin' },
      update: { passwordHash: hash, mustChangePassword: true },
      create: {
        username: 'admin',
        nickname: '超级管理员',
        role: 'super_admin',
        email: 'admin@archview.local',
        passwordHash: hash,
        mustChangePassword: true,
      },
    });
    await prisma.$disconnect();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    // 本用例会为断言而打开 admin 的首登强制改密标记；收尾恢复种子态，
    // 避免本地开发（与测试共用同一 SQLite）登录时被强制改密打断。
    const prisma = new PrismaClient();
    await prisma.user.update({ where: { username: 'admin' }, data: { mustChangePassword: false } });
    await prisma.$disconnect();
    await app.close();
  });

  it('种子超管登录成功，返回 access/refresh/user（M0）', async () => {
    const res = await http().post('/api/v1/auth/login').send(ADMIN).expect(201);
    expect(res.body.access).toBeTruthy();
    expect(res.body.refresh).toBeTruthy();
    expect(res.body.user.username).toBe('admin');
    expect(res.body.user.role).toBe('super_admin');
    expect(res.body.mustChangePassword).toBe(true);
  });

  it('密码错误 → 401（防枚举统一文案）', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'wrong-password' })
      .expect(401);
    expect(res.body.message).toBe('用户名或密码错误');
  });

  it('用户不存在 → 同样 401（防枚举）', async () => {
    await http()
      .post('/api/v1/auth/login')
      .send({ username: `nobody_${Date.now()}`, password: 'whatever-123' })
      .expect(401);
  });

  it('完整链路：创建用户 → 登录 → me → refresh → logout → 删除用户', async () => {
    const login = await http().post('/api/v1/auth/login').send(ADMIN).expect(201);
    const { access } = login.body;
    const username = `e2e_${Date.now()}`;

    // 超管创建普通用户
    const created = await http()
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${access}`)
      .send({ username, password: 'secret-12345', nickname: 'E2E 用户' })
      .expect(201);
    expect(created.body.role).toBe('user');
    const userId: string = created.body.id;

    // 新用户登录
    const uLogin = await http()
      .post('/api/v1/auth/login')
      .send({ username, password: 'secret-12345' })
      .expect(201);

    // me
    const me = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${uLogin.body.access}`)
      .expect(200);
    expect(me.body.username).toBe(username);

    // 无感刷新
    const refreshed = await http()
      .post('/api/v1/auth/refresh')
      .send({ refresh: uLogin.body.refresh })
      .expect(201);
    expect(refreshed.body.access).toBeTruthy();
    expect(refreshed.body.refresh).toBeTruthy();

    // 登出（204）
    await http()
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${uLogin.body.access}`)
      .send({ refresh: uLogin.body.refresh })
      .expect(204);

    // 清理
    await http()
      .delete(`/api/v1/users/${userId}`)
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
  });

  it('未携带 token → 401', async () => {
    await http().get('/api/v1/auth/me').expect(401);
  });

  it('普通用户访问 /users 列表 → 403（角色守卫）', async () => {
    const login = await http().post('/api/v1/auth/login').send(ADMIN).expect(201);
    const { access } = login.body;
    const username = `e2e_role_${Date.now()}`;
    const created = await http()
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${access}`)
      .send({ username, password: 'secret-12345' })
      .expect(201);

    const uLogin = await http()
      .post('/api/v1/auth/login')
      .send({ username, password: 'secret-12345' })
      .expect(201);

    await http()
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${uLogin.body.access}`)
      .expect(403);

    await http()
      .delete(`/api/v1/users/${created.body.id}`)
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
  });

  it('登录锁定：连续 5 次失败 → 429 LOGIN_LOCKED（含 retryAfter，FR-U01）', async () => {
    const login = await http().post('/api/v1/auth/login').send(ADMIN).expect(201);
    const access = login.body.access;
    const username = `lock_${Date.now().toString(36)}`;
    await http()
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${access}`)
      .send({ username, password: 'secret-12345' })
      .expect(201);

    // 连续 5 次错误密码
    for (let i = 0; i < 5; i++) {
      await http()
        .post('/api/v1/auth/login')
        .send({ username, password: 'wrong-pass' })
        .expect(401);
    }
    // 第 6 次：即使密码正确也 429 锁定
    const locked = await http()
      .post('/api/v1/auth/login')
      .send({ username, password: 'secret-12345' })
      .expect(429);
    expect(locked.body.code).toBe('LOGIN_LOCKED');
    expect(locked.body.detail.retryAfter).toBeGreaterThan(0);
  });
});
