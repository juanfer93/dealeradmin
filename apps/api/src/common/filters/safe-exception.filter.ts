import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

const PUBLIC_MESSAGES: Record<number, string> = {
  400: 'Invalid request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Invalid request',
  429: 'Too many requests',
};

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SafeExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;

    if (status >= 500) {
      this.logger.error(`Unhandled request failure: ${request.method} ${request.originalUrl} (${status})`);
    }

    response.status(status).json({
      statusCode: status,
      message: PUBLIC_MESSAGES[status] ?? 'Request failed',
    });
  }
}
