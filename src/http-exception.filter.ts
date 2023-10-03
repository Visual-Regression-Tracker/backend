import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): any {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    const isUniqueConstaintException = this.isUniqueConstraintException(exception);
    const isForbiddenException = this.isForbiddenException(exception);
    try {
      status = isUniqueConstaintException ? HttpStatus.BAD_REQUEST : exception.getStatus();
    } catch {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
    }
    const message =
      isUniqueConstaintException || isForbiddenException
        ? this.getCustomMessageForException(exception)
        : exception.message;

    Logger.error(exception, exception.stack, exception.getResponse?.());

    response.status(status).json({
      path: request.url,
      name: exception.name,
      message: message,
      exception: exception,
      stack: exception.stack,
    });
  }

  isForbiddenException(exception: HttpException): boolean {
    return exception.message.includes('Forbidden resource');
  }

  isUniqueConstraintException(exception: HttpException): boolean {
    return exception.message.includes('Unique constraint failed on the fields');
  }

  getCustomMessageForException(exception: HttpException): string {
    let message = exception.message;
    message = message.includes('build.update()')
      ? 'There is already a build with this ci build id.'
      : message.includes('project.create()')
      ? 'Project exists with this name.'
      : message.includes('user.create()')
      ? 'This user already exists.'
      : message.includes('Forbidden resource')
      ? 'You do not have permission to perform this operation.'
      : message;
    return message;
  }
}
