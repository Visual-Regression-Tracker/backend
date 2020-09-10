import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): any {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    try {
      status = exception.getStatus();
    } catch {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
    }
    response.status(status).json({
      path: request.url,
      name: exception.name,
      message: exception.message,
      exception: exception,
      stack: exception.stack,
    });
  }
}
