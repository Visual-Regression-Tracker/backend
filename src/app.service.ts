import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Server } from 'http';

@Injectable()
export class AppService implements OnApplicationBootstrap {
  constructor(
    private readonly refHost: HttpAdapterHost<any>,
    @Inject(ConfigService) private configService: ConfigService
  ) {}

  onApplicationBootstrap() {
    const server: Server = this.refHost.httpAdapter.getHttpServer();
    const { timeout, headersTimeout, keepAliveTimeout } = server;
    server.timeout = this.configService.get<number>('SERVER_TIMEOUT', timeout);
    server.headersTimeout = this.configService.get<number>('SERVER_HEADERS_TIMEOUT', headersTimeout);
    server.keepAliveTimeout = this.configService.get<number>('SERVER_KEEP_ALIVE_TIMEOUT', keepAliveTimeout);
  }
}
