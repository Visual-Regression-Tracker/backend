import { ExceptionFilter, Catch, ArgumentsHost, ForbiddenException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const error = exception instanceof Error ? exception : new Error(String(exception));

    const status = this.getStatus(error);
    const message =
      this.isUniqueConstraintException(error) || this.isForbiddenException(error)
        ? this.getCustomMessageForException(error)
        : this.getMessage(error);

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url} ${status}: ${message}`, error.stack);
    } else {
      this.logger.warn(`${request.method} ${request.url} ${status}: ${message}`);
    }

    const retryAfter = (exception as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
    if (typeof retryAfter === 'number') {
      response.setHeader('Retry-After', String(retryAfter));
    }

    response.status(status).json({ statusCode: status, path: request.url, name: error.name, message });
  }

  getStatus(exception: Error): number {
    if (this.isUniqueConstraintException(exception)) return HttpStatus.BAD_REQUEST;
    const code = (exception as { code?: unknown }).code;
    if (code === 'P2025') return HttpStatus.NOT_FOUND;
    if (code === 'P2003') return HttpStatus.CONFLICT;
    try {
      const status = (exception as { getStatus?: () => unknown }).getStatus?.();
      if (typeof status === 'number') return status;
    } catch {
      return HttpStatus.INTERNAL_SERVER_ERROR;
    }
    return this.getParserStatus(exception) ?? HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private getParserStatus(exception: Error): number | undefined {
    const { status, statusCode, type } = exception as { status?: unknown; statusCode?: unknown; type?: unknown };
    const clientStatus = Number(status ?? statusCode);
    return typeof type === 'string' && clientStatus >= 400 && clientStatus < 500 ? clientStatus : undefined;
  }

  isForbiddenException(exception: Error): boolean {
    return exception instanceof ForbiddenException && exception.message === 'Forbidden resource';
  }

  getMessage(exception: Error): string {
    const response = (exception as { getResponse?: () => unknown }).getResponse?.();
    const details = typeof response === 'object' ? (response as { message?: unknown } | null)?.message : undefined;
    return Array.isArray(details) ? details.join(', ') : exception.message;
  }

  isUniqueConstraintException(exception: Error): boolean {
    // P2002 message says "on the fields" before Prisma 7, "on the constraint" since
    return (
      (exception as { code?: unknown }).code === 'P2002' ||
      exception.message.includes('Unique constraint failed on the fields') ||
      exception.message.includes('Unique constraint failed on the constraint')
    );
  }

  getCustomMessageForException(exception: Error): string {
    const { message } = exception;
    if (message.includes('build.update()')) return 'There is already a build with this ci build id.';
    if (message.includes('project.create()')) return 'Project exists with this name.';
    if (message.includes('user.create()')) return 'This user already exists.';
    if (message.includes('Forbidden resource')) return 'You do not have permission to perform this operation.';
    return message;
  }
}
