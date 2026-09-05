import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * 统一错误格式（产品文档 §8.4）：{ code, message, detail? }
 * 前端 client.ts 按 code / message 消费。
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL';
    let message = '服务器内部错误';
    let detail: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      if (typeof r === 'string') {
        message = r;
        code = String(status);
      } else if (typeof r === 'object' && r !== null) {
        const o = r as Record<string, unknown>;
        const raw = o.message;
        if (Array.isArray(raw)) message = raw.join('；');
        else if (typeof raw === 'string') message = raw;
        code = typeof o.code === 'string' ? o.code : String(status);
        detail = o.detail;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(`${req.method} ${req.path} → ${exception.message}`, exception.stack);
    }

    res.status(status).json({ code, message, detail, path: req.path, method: req.method });
  }
}
