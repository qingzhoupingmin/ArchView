/**
 * 个人资料 API 集成测试（FR-U04 / T1.2）：PATCH /me · POST /me/password · GET /me。
 * 使用独立用户（避免改动种子 admin 状态，与 auth/users 测试并行时互不污染）。
 * 依赖：先执行 pnpm db:setup（种子超管 admin）。
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';

const ADMIN = { username: 'admin', password: 'admin123' };
const USER_PASSWORD = 'secret-12345';

describe('个人资料 API（FR-U04 / T1.2）', () => {
  let app: INestApplication;
  let token: string;
  let username: string;
  const http = () => request(app.getHttpServer());
  /** 带 token 的请求（supertest 6 的 agent 无 .set，逐请求设置） */
  const auth = (t: string) => ({
    get: (p: string) => http().get(p).set('Authorization', `Bearer ${t}`),
    /** body 可选：调用点也可链式 .send(body)（supertest Test 可链式调用） */
    patch: (p: string, body?: object) => {
      const req = http().patch(p).set('Authorization', `Bearer ${t}`);
      return body !== undefined ? req.send(body) : req;
    },
    post: (p: string, body?: object) => {
      const req = http().post(p).set('Authorization', `Bearer ${t}`);
      return body !== undefined ? req.send(body) : req;
    },
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    // 独立测试用户（超管创建）
    const adminLogin = await http().post('/api/v1/auth/login').send(ADMIN).expect(201);
    username = `meu_${Date.now().toString(36)}`;
    await http()
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminLogin.body.access}`)
      .send({ username, password: USER_PASSWORD })
      .expect(201);
    const login = await http().post('/api/v1/auth/login').send({ username, password: USER_PASSWORD }).expect(201);
    token = login.body.access;
  });

  afterAll(async () => {
    await app.close();
  });

  it('PATCH /me 修改昵称 / 头像，GET /me 生效', async () => {
    const updated = await auth(token).patch('/api/v1/me').send({ nickname: '小青青', avatar: '🦊' }).expect(200);
    expect(updated.body.nickname).toBe('小青青');
    expect(updated.body.avatar).toBe('🦊');
    expect(updated.body.username).toBe(username);

    const me = await auth(token).get('/api/v1/me').expect(200);
    expect(me.body.nickname).toBe('小青青');
    expect(me.body.avatar).toBe('🦊');
  });

  it('PATCH /me 未登录 → 401；邮箱格式错误 → 400', async () => {
    await http().patch('/api/v1/me').send({ nickname: 'x' }).expect(401);
    await auth(token).patch('/api/v1/me').send({ email: 'not-an-email' }).expect(400);
  });

  it('POST /me/password：原密码错 → 400；改密后旧密码失效、强制改密标记清除', async () => {
    // 超管重置密码 → mustChangePassword=true
    const adminLogin = await http().post('/api/v1/auth/login').send(ADMIN).expect(201);
    const list = await http()
      .get(`/api/v1/users?q=${username}`)
      .set('Authorization', `Bearer ${adminLogin.body.access}`)
      .expect(200);
    const userId: string = list.body[0].id;
    await http()
      .post(`/api/v1/users/${userId}/password`)
      .set('Authorization', `Bearer ${adminLogin.body.access}`)
      .send({ password: 'reset-pass-123' })
      .expect(201);

    // 用重置后的密码登录
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ username, password: 'reset-pass-123' })
      .expect(201);
    expect(login.body.mustChangePassword).toBe(true);
    const userToken = login.body.access;

    // 原密码（重置前的）不正确 → 400
    await auth(userToken).post('/api/v1/me/password').send({ oldPassword: USER_PASSWORD, newPassword: 'final-pass-456' }).expect(400);

    // 改密成功 → mustChangePassword 清除
    const updated = await auth(userToken)
      .post('/api/v1/me/password')
      .send({ oldPassword: 'reset-pass-123', newPassword: 'final-pass-456' })
      .expect(201);
    expect(updated.body.mustChangePassword).toBe(false);

    // 旧密码登录 401，新密码 201
    await http().post('/api/v1/auth/login').send({ username, password: 'reset-pass-123' }).expect(401);
    await http().post('/api/v1/auth/login').send({ username, password: 'final-pass-456' }).expect(201);
    token = userToken;
  });

  it('改密后其它设备 refresh 吊销（多端下线，FR-U03）', async () => {
    const l1 = await http().post('/api/v1/auth/login').send({ username, password: 'final-pass-456' }).expect(201);
    const l2 = await http().post('/api/v1/auth/login').send({ username, password: 'final-pass-456' }).expect(201);

    // 第二个会话改密（同值）→ 吊销全部 refresh
    await auth(l2.body.access)
      .post('/api/v1/me/password')
      .send({ oldPassword: 'final-pass-456', newPassword: 'final-pass-456' })
      .expect(201);

    // 第一个会话的 refresh 已失效
    await http().post('/api/v1/auth/refresh').send({ refresh: l1.body.refresh }).expect(401);
  });
});