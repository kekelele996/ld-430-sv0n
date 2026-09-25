import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { logger } from '../utils/logger';

@Catch()
export class ErrorHandlerMiddleware implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const rawMessage = exception instanceof Error ? exception.message : 'Unexpected error';
    logger.error(rawMessage, exception);

    // HttpException 可携带结构化响应（如分类移动冲突的最新层级），需原样透传给客户端。
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        return response.status(status).json({ success: false, statusCode: status, ...(body as Record<string, unknown>) });
      }
      return response.status(status).json({ success: false, message: body as string, statusCode: status });
    }

    response.status(status).json({ success: false, message: rawMessage, statusCode: status });
  }
}
