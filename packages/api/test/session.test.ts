/**
 * 会话失效与断权集成测试（数据隔离专项·批次 B/S4 + C）。
 *
 * 钉住的核心语义：管理员禁用 / 删除账号后，该账号手里的 access 令牌**立即**失效。
 * 改造前 JwtAuthGuard 只验签不查库 → 令牌在 2 小时有效期内照样读写数据，
 * 被软删的超管甚至还能继续建号改角色（PermissionsGuard 当时只看 role）。
 * 依赖：先执行 pnpm db:setup（种子超管 admin）。
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';

const ADMIN = { username: 'admin', password: 'admin123' };
const PW = 'secret-12345';

describe('会话断权（批次 B/S4）', () => {
  let app: INestApplication;
  let adminToken: string;
  const prisma = new PrismaClient();
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const suffix = Date.now().toString(36);

  const createdUsers: string[] = [];

  /** 建号 + 登录，返回 { id, access, refresh } */
  async function makeUser(username: string, role: 'user' | 'super_admin' = 'user') {
    const created = await http()
      .post('/api/v1/users')
      .set(bearer(adminToken))
      .send({ username, password: PW, role })
      .expect(201);
    createdUsers.push(username);
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ username, password: PW })
      .expect(201);
    return { id: created.body.id as string, access: login.body.access, refresh: login.body.refresh };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    adminToken = (await http().post('/api/v1/auth/login').send(ADMIN).expect(201)).body.access;
  });

  afterAll(async () => {
    for (const u of createdUsers) {
      const row = await prisma.user.findUnique({ where: { username: u } });
      if (row) await prisma.user.delete({ where: { id: row.id } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('禁用账号后：旧 access 令牌立刻 401，旧 refresh 也换不到新令牌', async () => {
    const username = `sess_dis_${suffix}`;
    const u = await makeUser(username);

    await http().get('/api/v1/projects').set(bearer(u.access)).expect(200);
    await http()
      .patch(`/api/v1/users/${u.id}/status`)
      .set(bearer(adminToken))
      .send({ status: 'disabled' })
      .expect(200);

    await http().get('/api/v1/projects').set(bearer(u.access)).expect(401);
    await http().post('/api/v1/auth/refresh').send({ refresh: u.refresh }).expect(401);

    // 重新启用 → 可再次登录（禁用不是删号）
    await http()
      .patch(`/api/v1/users/${u.id}/status`)
      .set(bearer(adminToken))
      .send({ status: 'active' })
      .expect(200);
    await http().post('/api/v1/auth/login').send({ username, password: PW }).expect(201);
  });

  it('软删超管后：其旧 access 令牌不能再访问 /users（旧实现此时仍是 200）', async () => {
    const username = `sess_adm_${suffix}`;
    const u = await makeUser(username, 'super_admin');

    // 删除前确有权限
    await http().get('/api/v1/users').set(bearer(u.access)).expect(200);
    await http().delete(`/api/v1/users/${u.id}`).set(bearer(adminToken)).expect(200);

    // 关键断言：账号已软删，手里那枚还没到期的 access 必须即刻作废
    await http().get('/api/v1/users').set(bearer(u.access)).expect(401);
    await http()
      .post('/api/v1/users')
      .set(bearer(u.access))
      .send({ username: `sess_ghost_${suffix}`, password: PW })
      .expect(401);
    // 软删同时吊销 refresh（与 setStatus 口径对齐）
    await http().post('/api/v1/auth/refresh').send({ refresh: u.refresh }).expect(401);
  });

  it('refresh 令牌不得当 access 用（拿 7 天凭据直打业务接口）', async () => {
    const username = `sess_rft_${suffix}`;
    const u = await makeUser(username);
    await http().get('/api/v1/projects').set(bearer(u.refresh)).expect(401);
  });

  it('purge=true 硬删账号：级联回收其名下工程（消灭无主孤儿，S8）', async () => {
    const username = `sess_prg_${suffix}`;
    const u = await makeUser(username);
    const project = await http()
      .post('/api/v1/projects')
      .set(bearer(u.access))
      .send({ name: `待清除 ${suffix}`, data: {} })
      .expect(201);

    await http().delete(`/api/v1/users/${u.id}?purge=true`).set(bearer(adminToken)).expect(200);

    expect(await prisma.user.findUnique({ where: { id: u.id } })).toBeNull();
    expect(await prisma.project.count({ where: { id: project.body.id } })).toBe(0);
  });
});
