/**
 * Projects API 集成测试（T0.8 / FR-U07）：创建 / 获取 / 更新 / 列表 / 删除。
 * 依赖：先执行 pnpm db:setup。
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';

const ADMIN = { username: 'admin', password: 'admin123' };

describe('Projects API（FR-U07）', () => {
  let app: INestApplication;
  let access = '';
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    const login = await http().post('/api/v1/auth/login').send(ADMIN).expect(201);
    access = login.body.access;
  });

  afterAll(async () => {
    await app.close();
  });

  it('创建 → 获取（含 data）→ 更新名称 → 列表包含 → 删除', async () => {
    const name = `E2E 工程 ${Date.now()}`;

    const created = await http()
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${access}`)
      .send({ name, data: { hello: 'archview', n: 1 } })
      .expect(201);
    expect(created.body.name).toBe(name);
    const id: string = created.body.id;

    const full = await http()
      .get(`/api/v1/projects/${id}`)
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    expect(full.body.data.hello).toBe('archview');
    expect(full.body.data.n).toBe(1);

    const updated = await http()
      .patch(`/api/v1/projects/${id}`)
      .set('Authorization', `Bearer ${access}`)
      .send({ name: `${name}-v2` })
      .expect(200);
    expect(updated.body.name).toBe(`${name}-v2`);

    const list = await http().get('/api/v1/projects').set('Authorization', `Bearer ${access}`).expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.some((p: { id: string }) => p.id === id)).toBe(true);

    await http()
      .delete(`/api/v1/projects/${id}`)
      .set('Authorization', `Bearer ${access}`)
      .expect(204);

    await http()
      .get(`/api/v1/projects/${id}`)
      .set('Authorization', `Bearer ${access}`)
      .expect(404);
  });

  it('未登录 → 401', async () => {
    await http().get('/api/v1/projects').expect(401);
  });
});
