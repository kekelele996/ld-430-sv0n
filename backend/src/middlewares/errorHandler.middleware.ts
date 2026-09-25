import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { logger } from '../utils/logger';

@Catch()
export class ErrorHandlerMiddleware implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      // 参数校验错误：Nest 会返回 message 数组，原样保留以便前端逐条提示
      if (Array.isArray(res)) {
        return response.status(status).json({ success: false, statusCode: status, message: res });
      }
      // 业务异常可携带结构化数据（如并发冲突时的最新层级 currentTree），直接透传
      if (res !== null && typeof res === 'object') {
        const payload = res as Record<string, unknown>;
        return response.status(status).json({
          success: false,
          statusCode: status,
          ...payload,
          message: typeof payload.message === 'string' ? payload.message : exception.message,
        });
      }
      return response.status(status).json({ success: false, message: res as string, statusCode: status });
    }

    const message = exception instanceof Error ? exception.message : 'Unexpected error';
    logger.error(message, exception);
    response.status(status).json({ success: false, message, statusCode: status });
  }
}
