import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HealthCheckService, PrismaHealthIndicator, TerminusModule } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

describe('Health Controller', () => {
  let controller: HealthController;

  describe('check', () => {
    it('runs a single indicator that pings the database with a timeout', async () => {
      const health = { check: jest.fn().mockResolvedValue('result') };
      const prismaHealth = { pingCheck: jest.fn().mockResolvedValue({ database: { status: 'up' } }) };
      const prisma = {};
      const healthController = new HealthController(
        health as unknown as HealthCheckService,
        prismaHealth as unknown as PrismaHealthIndicator,
        prisma as unknown as PrismaService
      );

      await expect(healthController.check()).resolves.toBe('result');

      const [indicators] = health.check.mock.calls[0];
      expect(indicators).toHaveLength(1);
      await expect(indicators[0]()).resolves.toEqual({ database: { status: 'up' } });
      expect(prismaHealth.pingCheck).toHaveBeenCalledWith('database', prisma, { timeout: 3000 });
    });
  });

  describe('check with the real terminus HealthCheckService', () => {
    let prisma: { $runCommandRaw: jest.Mock; $queryRawUnsafe: jest.Mock };

    beforeEach(async () => {
      prisma = {
        $runCommandRaw: jest
          .fn()
          .mockRejectedValue(
            new Error('The postgresql provider does not support $runCommandRaw. Use the mongodb provider.')
          ),
        $queryRawUnsafe: jest.fn(),
      };
      const module = await Test.createTestingModule({
        imports: [TerminusModule.forRoot({ logger: false })],
        controllers: [HealthController],
        providers: [{ provide: PrismaService, useValue: prisma }],
      }).compile();
      controller = module.get(HealthController);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('reports the database as up', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }]);

      await expect(controller.check()).resolves.toEqual({
        status: 'ok',
        info: { database: { status: 'up', responseTime: expect.any(Number) } },
        error: {},
        details: { database: { status: 'up', responseTime: expect.any(Number) } },
      });
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith('SELECT 1');
    });

    it('answers 503 when the database fails', async () => {
      prisma.$queryRawUnsafe.mockRejectedValue(new Error('Can not reach database server'));

      const result = controller.check();

      await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
      const error = (await result.catch((e: ServiceUnavailableException) => e)) as ServiceUnavailableException;
      expect((error.getResponse() as { error: Record<string, { status: string }> }).error.database.status).toBe('down');
    });

    it('answers 503 when the database does not answer within 3 s', async () => {
      jest.useFakeTimers();
      prisma.$queryRawUnsafe.mockReturnValue(new Promise(() => undefined));

      const result = controller.check().catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(3000);

      await expect(result).resolves.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
