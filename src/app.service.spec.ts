import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpAdapterHost } from '@nestjs/core';
import { AppService } from './app.service';
import { ConfigService } from '@nestjs/config';

describe('AppService', () => {
  let service: AppService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppService,
        {
          provide: ConfigService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<AppService>(AppService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onApplicationBootstrap', () => {
    const ENV_KEYS = ['SERVER_TIMEOUT', 'SERVER_HEADERS_TIMEOUT', 'SERVER_KEEP_ALIVE_TIMEOUT'];
    const originalEnv = { ...process.env };
    let logSpy: jest.SpyInstance;

    const bootstrap = (config: Record<string, string> = {}) => {
      const server = { timeout: 0, headersTimeout: 60000, keepAliveTimeout: 5000 };
      const refHost = { httpAdapter: { getHttpServer: () => server } } as unknown as HttpAdapterHost;
      new AppService(refHost, new ConfigService(config)).onApplicationBootstrap();
      return server;
    };

    beforeEach(() => {
      ENV_KEYS.forEach((key) => delete process.env[key]);
      logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    });

    afterEach(() => {
      process.env = { ...originalEnv };
      logSpy.mockRestore();
    });

    it('keeps the server defaults when no overrides are configured', () => {
      expect(bootstrap()).toEqual({ timeout: 0, headersTimeout: 60000, keepAliveTimeout: 5000 });
    });

    it('applies the configured timeouts', () => {
      const server = bootstrap({
        SERVER_TIMEOUT: '120000',
        SERVER_HEADERS_TIMEOUT: '65000',
        SERVER_KEEP_ALIVE_TIMEOUT: '61000',
      });

      expect(server).toEqual({ timeout: 120000, headersTimeout: 65000, keepAliveTimeout: 61000 });
    });

    it('reads the overrides from the environment', () => {
      process.env.SERVER_KEEP_ALIVE_TIMEOUT = '7000';

      expect(bootstrap()).toEqual({ timeout: 0, headersTimeout: 60000, keepAliveTimeout: 7000 });
    });

    it('overrides each timeout independently', () => {
      expect(bootstrap({ SERVER_HEADERS_TIMEOUT: '1' })).toEqual({
        timeout: 0,
        headersTimeout: 1,
        keepAliveTimeout: 5000,
      });
    });

    it('truncates a fractional value to an integer', () => {
      expect(bootstrap({ SERVER_TIMEOUT: '1500.9' }).timeout).toBe(1500);
    });

    // NOTE: current behavior — the value is parsed with parseInt and never
    // validated, so a typo in the env sets the timeout to NaN.
    it('sets NaN for a non-numeric override', () => {
      expect(bootstrap({ SERVER_TIMEOUT: 'abc' }).timeout).toBeNaN();
    });

    it('logs every resulting timeout', () => {
      bootstrap({ SERVER_TIMEOUT: '10' });

      expect(logSpy).toHaveBeenCalledWith('server.timeout is 10');
      expect(logSpy).toHaveBeenCalledWith('server.headersTimeout is 60000');
      expect(logSpy).toHaveBeenCalledWith('server.keepAliveTimeout is 5000');
    });
  });
});
