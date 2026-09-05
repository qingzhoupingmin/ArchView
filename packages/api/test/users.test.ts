/**
 * 用户管理 API 集成测试（FR-U05 / T1.3）：
 * 启禁用 / 软删 / 重置密码 / 角色调整（最后超管保护）/ 列表筛选。
 * 依赖：先执行 pnpm db:setup（种子超管 admin）。
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';

const ADMIN = { username: 'admin', password: 'admin123' };

describe('用户管理 API（FR-U05 / T1.3）', () => {
  let app: INestApplication;
  let adminToken: string;
  const http = () => request(app.getHttpServer());
  /** 带超管 token 的请求（supertest 6 的 agent 无 .set，逐请求设置） */
  const auth = (token: string) => ({
    get: (p: string) => http().get(p).set('Authorization', `Bearer ${token}`),
    /** body 可选：调用点也可链式 .send(body)（supertest Test 可链式调用） */
    post: (p: string, body?: object) => {
      const req = http().post(p).set('Authorization', `Bearer ${token}`);
      return body !== undefined ? req.send(body) : req;
    },
    patch: (p: string, body?: object) => {
      const req = http().patch(p).set('Authorization', `Bearer ${token}`);
      return body !== undefined ? req.send(body) : req;
    },
    delete: (p: string) => http().delete(p).set('Authorization', `Bearer ${token}`),
  });
  const suffix = Date.now().toString(36);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    const login = await http().post('/api/v1/auth/login').send(ADMIN).expect(201);
    adminToken = login.body.access;
  });

  afterAll(async () => {
    await app.close();
  });

  it('创建 → 列表可见 → 禁用后不可登录 → 启用后可登录', async () => {
    const username = `t13_${suffix}`;
    const created = await auth(adminToken)
      .post('/api/v1/users')
      .send({ username, password: 'secret-12345', nickname: 'T13 用户' })
      .expect(201);
    const userId: string = created.body.id;
    expect(created.body.status).toBe('active');

    // 列表可见
    const list = await auth(adminToken).get('/api/v1/users').expect(200);
    expect(list.body.some((u: { id: string }) => u.id === userId)).toBe(true);

    // 禁用 → 登录 401
    await auth(adminToken).patch(`/api/v1/users/${userId}/status`).send({ status: 'disabled' }).expect(200);
    await http().post('/api/v1/auth/login').send({ username, password: 'secret-12345' }).expect(401);

    // 启用 → 登录 201
    const enabled = await auth(adminToken)
      .patch(`/api/v1/users/${userId}/status`)
      .send({ status: 'active' })
      .expect(200);
    expect(enabled.body.status).toBe('active');
    await http().post('/api/v1/auth/login').send({ username, password: 'secret-12345' }).expect(201);

    // 清理（软删）
    await auth(adminToken).delete(`/api/v1/users/${userId}`).expect(200);
  });

  it('软删后列表不再展示', async () => {
    const username = `t13del_${suffix}`;
    const created = await auth(adminToken)
      .post('/api/v1/users')
      .send({ username, password: 'secret-12345' })
      .expect(201);
    const userId: string = created.body.id;
    await auth(adminToken).delete(`/api/v1/users/${userId}`).expect(200);

    const list = await auth(adminToken).get('/api/v1/users').expect(200);
    expect(list.body.some((u: { id: string }) => u.id === userId)).toBe(false);
  });

  it('重置密码：新密码登录成功 + 强制改密标记 + 旧 refresh 失效', async () => {
    const username = `t13pwd_${suffix}`;
    const created = await auth(adminToken)
      .post('/api/v1/users')
      .send({ username, password: 'old-pass-123' })
      .expect(201);
    const userId: string = created.body.id;

    const login = await http()
      .post('/api/v1/auth/login')
      .send({ username, password: 'old-pass-123' })
      .expect(201);

    await auth(adminToken)
      .post(`/api/v1/users/${userId}/password`)
      .send({ password: 'new-pass-456' })
      .expect(201);

    // 旧密码 401，新密码 201 且 mustChangePassword=true
    await http().post('/api/v1/auth/login').send({ username, password: 'old-pass-123' }).expect(401);
    const relogin = await http()
      .post('/api/v1/auth/login')
      .send({ username, password: 'new-pass-456' })
      .expect(201);
    expect(relogin.body.mustChangePassword).toBe(true);

    // 重置前签发的 refresh 已吊销
    await http().post('/api/v1/auth/refresh').send({ refresh: login.body.refresh }).expect(401);

    await auth(adminToken).delete(`/api/v1/users/${userId}`).expect(200);
  });

  it('最后超管保护：不能降级 / 删除最后一名超管', async () => {
    // 防御：清理历史运行残留的超管（避免污染「最后一名」计数）
    const existing = await auth(adminToken).get('/api/v1/users?role=super_admin').expect(200);
    for (const u of existing.body as Array<{ id: string; username: string }>) {
      if (u.username !== 'admin') {
        await auth(adminToken).patch(`/api/v1/users/${u.id}/role`).send({ role: 'user' }).expect(200);
      }
    }

    const username = `t13sa_${suffix}`;
    // 创建第二个超管
    const created = await auth(adminToken)
      .post('/api/v1/users')
      .send({ username, password: 'secret-12345', role: 'super_admin' })
      .expect(201);
    const userId: string = created.body.id;
    expect(created.body.role).toBe('super_admin');

    // 此时有 2 名超管：降级第二个 → 成功（剩 1 名）
    await auth(adminToken).patch(`/api/v1/users/${userId}/role`).send({ role: 'user' }).expect(200);

    // 现在只剩 admin 一名超管：降级 / 删除 admin 都应 400
    const adminMe = await auth(adminToken).get('/api/v1/auth/me').expect(200);
    await auth(adminToken).patch(`/api/v1/users/${adminMe.body.id}/role`).send({ role: 'user' }).expect(400);
    await auth(adminToken).delete(`/api/v1/users/${adminMe.body.id}`).expect(400);

    await auth(adminToken).delete(`/api/v1/users/${userId}`).expect(200);
  });

  it('列表筛选：q / role / status', async () => {
    const username = `t13filter_${suffix}`;
    const created = await auth(adminToken)
      .post('/api/v1/users')
      .send({ username, password: 'secret-12345', nickname: '筛选测试用户' })
      .expect(201);

    const byQ = await auth(adminToken).get(`/api/v1/users?q=${username}`).expect(200);
    expect(byQ.body.length).toBeGreaterThan(0);
    expect(byQ.body.every((u: { username: string }) => u.username.includes(username))).toBe(true);

    const byRole = await auth(adminToken).get('/api/v1/users?role=super_admin').expect(200);
    expect(byRole.body.length).toBeGreaterThan(0);
    expect(byRole.body.every((u: { role: string }) => u.role === 'super_admin')).toBe(true);
    expect(byRole.body.some((u: { id: string }) => u.id === created.body.id)).toBe(false);

    await auth(adminToken).delete(`/api/v1/users/${created.body.id}`).expect(200);
  });
});
