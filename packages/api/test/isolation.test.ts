/**
 * 跨账号数据隔离集成测试（数据隔离专项·批次 C）。
 *
 * 补的是此前完全空缺的一类断言：projects.test.ts 只有超管单账号的 happy path，
 * 「A 的工程 B 碰不得」这条核心隔离语义一条用例都没盖到 —— 于是归属过滤
 * 只能靠人肉记得写 where（批次 B 已收口到 ProjectRepository，这里防它复发）。
 * 依赖：先执行 pnpm db:setup（迁移 + 种子超管 admin）。
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/audit/audit.service';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';

const ADMIN = { username: 'admin', password: 'admin123' };
const PW = 'secret-12345';

describe('跨账号数据隔离（批次 B/C）', () => {
  let app: INestApplication;
  let audit: AuditService;
  const prisma = new PrismaClient();
  const http = () => request(app.getHttpServer());
  const suffix = Date.now().toString(36);

  /** 用户名 → 登录，返回 access token */
  const login = async (username: string, password = PW) => {
    const res = await http().post('/api/v1/auth/login').send({ username, password }).expect(201);
    return res.body.access as string;
  };
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  let adminToken: string;
  let userA: string; // 属主
  let userB: string; // 同级别的另一个普通用户
  let tokenA: string;
  let tokenB: string;
  let projectA: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    audit = moduleRef.get(AuditService);

    adminToken = await login(ADMIN.username, ADMIN.password);

    userA = `iso_a_${suffix}`;
    userB = `iso_b_${suffix}`;
    for (const u of [userA, userB]) {
      const created = await http()
        .post('/api/v1/users')
        .set(bearer(adminToken))
        .send({ username: u, password: PW })
        .expect(201);
      expect(created.body.role).toBe('user');
    }
    tokenA = await login(userA);
    tokenB = await login(userB);

    const created = await http()
      .post('/api/v1/projects')
      .set(bearer(tokenA))
      .send({ name: `A 的工程 ${suffix}`, data: { schemaVersion: 1, secret: 'A 的机房布局' } })
      .expect(201);
    projectA = created.body.id as string;
    expect(created.body.ownerId).toBeTruthy();
    expect(created.body.canEdit).toBe(true);
  });

  afterAll(async () => {
    // 硬删收尾：软删会留下「有工程但账号已删」的脏库，污染后续本地开发与测试
    for (const u of [userA, userB]) {
      const row = await prisma.user.findUnique({ where: { username: u } });
      if (row) await prisma.user.delete({ where: { id: row.id } }); // FK cascade 连带清工程与令牌
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('B 读取 A 的工程 → 404（不是 403：不向非属主泄露「存在但不可见」）', async () => {
    const res = await http().get(`/api/v1/projects/${projectA}`).set(bearer(tokenB)).expect(404);
    expect(res.body.message).toBe('工程不存在');
  });

  it('B 改 / 删 A 的工程 → 404', async () => {
    await http()
      .patch(`/api/v1/projects/${projectA}`)
      .set(bearer(tokenB))
      .send({ name: '被 B 改名了' })
      .expect(404);
    await http().delete(`/api/v1/projects/${projectA}`).set(bearer(tokenB)).expect(404);

    // 名字没被改掉 = 写路径确实没进去
    const full = await http().get(`/api/v1/projects/${projectA}`).set(bearer(tokenA)).expect(200);
    expect(full.body.name).toBe(`A 的工程 ${suffix}`);
  });

  it('B 的列表里不含 A 的工程；A 的列表里全是他自己的', async () => {
    const listB = await http().get('/api/v1/projects').set(bearer(tokenB)).expect(200);
    expect(listB.body.some((p: { id: string }) => p.id === projectA)).toBe(false);
    const listA = await http().get('/api/v1/projects').set(bearer(tokenA)).expect(200);
    const aId = listA.body[0].ownerId as string;
    expect(listA.body.every((p: { ownerId: string }) => p.ownerId === aId)).toBe(true);
    expect(listA.body.some((p: { id: string }) => p.id === projectA)).toBe(true);
  });

  it('B 试图伪造 ownerId 建工程 → 字段被 whitelist 剥掉，工程仍归 B 自己', async () => {
    const ownerAId = (await prisma.user.findUnique({ where: { username: userA } }))!.id;
    const created = await http()
      .post('/api/v1/projects')
      .set(bearer(tokenB))
      .send({ name: `B 想赖给 A ${suffix}`, ownerId: ownerAId, data: {} })
      .expect(201);
    expect(created.body.ownerId).not.toBe(ownerAId);
    const listB = await http().get('/api/v1/projects').set(bearer(tokenB)).expect(200);
    expect(listB.body.some((p: { id: string }) => p.id === created.body.id)).toBe(true);
  });

  it('超管可读全部工程（project:view-all），但 canEdit=false 且改删一律 404', async () => {
    const full = await http()
      .get(`/api/v1/projects/${projectA}`)
      .set(bearer(adminToken))
      .expect(200);
    expect(full.body.canEdit).toBe(false);
    expect(full.body.ownerId).toBeTruthy();

    await http()
      .patch(`/api/v1/projects/${projectA}`)
      .set(bearer(adminToken))
      .send({ name: '超管想改' })
      .expect(404);
    await http().delete(`/api/v1/projects/${projectA}`).set(bearer(adminToken)).expect(404);
  });

  it('超管读他人工程会写审计（project.read_foreign）+ 普通用户查不到审计', async () => {
    await audit.flush();
    const res = await http()
      .get('/api/v1/audit')
      .set(bearer(adminToken))
      .query({ action: 'project.read_foreign', target: projectA })
      .expect(200);
    expect(res.body.total).toBeGreaterThan(0);
    await http().get('/api/v1/audit').set(bearer(tokenB)).expect(403);
  });

  it('visibility 置 shared 也不放开访问（FR-U08 分享属 P3，未实现前不得提前生效）', async () => {
    await prisma.project.update({ where: { id: projectA }, data: { visibility: 'shared' } });
    await http().get(`/api/v1/projects/${projectA}`).set(bearer(tokenB)).expect(404);
    await prisma.project.update({ where: { id: projectA }, data: { visibility: 'private' } });
  });

  it('乐观锁：baseVersion 正确则版本自增，过期则 409 PROJECT_CONFLICT（S9）', async () => {
    const ok = await http()
      .patch(`/api/v1/projects/${projectA}`)
      .set(bearer(tokenA))
      .send({ data: { schemaVersion: 1, n: 2 }, baseVersion: 1 })
      .expect(200);
    expect(ok.body.version).toBe(2);

    const stale = await http()
      .patch(`/api/v1/projects/${projectA}`)
      .set(bearer(tokenA))
      .send({ data: { schemaVersion: 1, n: 3 }, baseVersion: 1 })
      .expect(409);
    expect(stale.body.code).toBe('PROJECT_CONFLICT');
    expect(stale.body.detail.serverVersion).toBe(2);

    // 不带 baseVersion 的旧客户端仍可直接覆盖（渐进兼容），但版本继续自增
    const legacy = await http()
      .patch(`/api/v1/projects/${projectA}`)
      .set(bearer(tokenA))
      .send({ data: { schemaVersion: 1, n: 4 } })
      .expect(200);
    expect(legacy.body.version).toBe(3);
  });

  it('属主被软删后：工程对 B 仍不可见，对超管可见且标记 ownerDeleted', async () => {
    const aId = (await prisma.user.findUnique({ where: { username: userA } }))!.id;
    await http().delete(`/api/v1/users/${aId}`).set(bearer(adminToken)).expect(200);

    const list = await http().get('/api/v1/projects').set(bearer(adminToken)).expect(200);
    const row = list.body.find((p: { id: string }) => p.id === projectA);
    expect(row).toBeTruthy();
    expect(row.ownerDeleted).toBe(true);
    expect(row.canEdit).toBe(false);

    await http().get(`/api/v1/projects/${projectA}`).set(bearer(tokenB)).expect(404);
  });
});
