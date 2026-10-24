import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, TerminusModule } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

describe('Health Controller', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: {} },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('check', () => {
    it('runs a single indicator that queries SELECT 1', async () => {
      const health = { check: jest.fn().mockResolvedValue('result') };
      const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
      const healthController = new HealthController(
        health as unknown as HealthCheckService,
        prisma as unknown as PrismaService
      );

      await expect(healthController.check()).resolves.toBe('result');

      const [indicators] = health.check.mock.calls[0];
      expect(indicators).toHaveLength(1);
      await indicators[0]();
      const [strings] = prisma.$queryRaw.mock.calls[0];
      expect([...strings]).toEqual(['SELECT 1']);
    });
  });

  describe('check with the real terminus HealthCheckService', () => {
    let prisma: { $queryRaw: jest.Mock };

    beforeEach(async () => {
      prisma = { $queryRaw: jest.fn() };
      const module = await Test.createTestingModule({
        imports: [TerminusModule.forRoot({ logger: false })],
        controllers: [HealthController],
        providers: [{ provide: PrismaService, useValue: prisma }],
      }).compile();
      controller = module.get(HealthController);
    });

    // NOTE: current behavior — the raw query result is not a terminus
    // HealthIndicatorResult, so the report names no "database" indicator at all.
    it('reports ok with empty details when the database answers', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      await expect(controller.check()).resolves.toEqual({ status: 'ok', info: {}, error: {}, details: {} });
    });

    // NOTE: current behavior — the indicator does not throw a terminus
    // HealthCheckError, so terminus rethrows the raw error instead of
    // answering 503; through the global filter /health then answers 500.
    it('rethrows the raw database error instead of a 503', async () => {
      const error = new Error('Can not reach database server');
      prisma.$queryRaw.mockRejectedValue(error);

      const result = controller.check();

      await expect(result).rejects.toBe(error);
      await expect(result).rejects.not.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
