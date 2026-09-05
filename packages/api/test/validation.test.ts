/**
 * DTO 校验回归测试：守护「esbuild（tsx/vitest）不发射 design:paramtypes，
 * 导致全局 ValidationPipe 把 DTO 当 Object、校验被静默跳过」的问题。
 * 依赖 setup.ts 中的 registerDtoMetadata() 补齐元数据。
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';

describe('DTO 校验（design:paramtypes 元数据回归）', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('login：password 过短 → 400（元数据缺失时会误判为 401）', async () => {
    const res = await http().post('/api/v1/auth/login').send({ username: 'a', password: 'x' });
    expect(res.status).toBe(400);
  });

  it('login：字段类型错误（username 传数字）→ 400', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ username: 123, password: 'valid-pass-123' });
    expect(res.status).toBe(400);
  });

  it('me：email 格式错误 → 400（需登录态）', async () => {
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'admin123' })
      .expect(201);
    const res = await http()
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${login.body.access}`)
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});