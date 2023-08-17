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
    const { timeout, headersTimeout, keepAliveTimeout } = server;
    server.timeout = parseInt(this.configService.get('SERVER_TIMEOUT', timeout.toString()));
    this.logger.log(`server.timeout is ${server.timeout}`);
    server.headersTimeout = parseInt(this.configService.get('SERVER_HEADERS_TIMEOUT', headersTimeout.toString()));
    this.logger.log(`server.headersTimeout is ${server.headersTimeout}`);
    server.keepAliveTimeout = parseInt(
      this.configService.get('SERVER_KEEP_ALIVE_TIMEOUT', keepAliveTimeout.toString())
    );
    this.logger.log(`server.keepAliveTimeout is ${server.keepAliveTimeout}`);
  }
}
