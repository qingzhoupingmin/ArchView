/**
 * 请求主体（数据隔离专项·批次 B）。
 * 由 JwtAuthGuard 查库校验「存在 + 未软删 + active」后注入 req.user，
 * 业务层一律以它为归属判定依据 —— 不接受任何来自客户端的 userId / role。
 */
export interface Actor {
  id: string;
  role: string;
}
