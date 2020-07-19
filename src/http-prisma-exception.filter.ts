import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { PrismaClientKnownRequestError } from '@prisma/client';

@Catch(PrismaClientKnownRequestError)
export class HttpPrismaExceptionFilter implements ExceptionFilter {
  catch(exception: PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      stack: exception.stack,
      message: exception.message,
      code: exception.code,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
