import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): any {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message = exception.message;
    if (message.includes("Unique constraint failed on the fields")) {
      message = (message.includes("build.update()")) ? "There is already a build with this ci build id."
        : (message.includes("project.create()")) ? "Project exists with this name."
          : (message.includes("user.create()")) ? "This user already exists." : message;

      status = HttpStatus.BAD_REQUEST
    } else {
      try {
        status = exception.getStatus();
      } catch {
        status = HttpStatus.INTERNAL_SERVER_ERROR;
      }
    }

    Logger.error(exception, exception.stack);

    response.status(status).json({
      path: request.url,
      name: exception.name,
      message: message,
      exception: exception,
      stack: exception.stack,
    });
  }
}
