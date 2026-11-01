import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Server } from 'http';

@Injectable()
export class AppService implements OnApplicationBootstrap {
  private readonly logger: Logger = new Logger(AppService.name);

  constructor(
    private readonly refHost: HttpAdapterHost<any>,
    @Inject(ConfigService) private configService: ConfigService
  ) {}

  onApplicationBootstrap() {
    const server: Server = this.refHost.httpAdapter.getHttpServer();
    server.timeout = this.readTimeout('SERVER_TIMEOUT', server.timeout);
    this.logger.log(`server.timeout is ${server.timeout}`);
    server.headersTimeout = this.readTimeout('SERVER_HEADERS_TIMEOUT', server.headersTimeout);
    this.logger.log(`server.headersTimeout is ${server.headersTimeout}`);
    server.keepAliveTimeout = this.readTimeout('SERVER_KEEP_ALIVE_TIMEOUT', server.keepAliveTimeout);
    this.logger.log(`server.keepAliveTimeout is ${server.keepAliveTimeout}`);
  }

  private readTimeout(name: string, fallback: number): number {
    const raw = this.configService.get<string>(name);
    if (raw === undefined || String(raw).trim() === '') return fallback;
    const value = parseInt(String(raw), 10);
    if (Number.isNaN(value) || value < 0) {
      this.logger.warn(`${name}="${raw}" is not a number of milliseconds; keeping ${fallback}`);
      return fallback;
    }
    return value;
  }
}
