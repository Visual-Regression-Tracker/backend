import { INestApplication, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { SchedulerRegistry } from '@nestjs/schedule';
import { HealthCheckService } from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppService } from './app.service';
import { validateEnv } from './config/env.validation';
import { AuthService } from './auth/auth.service';
import { ApiGuard } from './auth/guards/api.guard';
import { JwtAuthGuard } from './auth/guards/auth.guard';
import { JwtStrategy } from './auth/jwt.strategy';
import { BuildsController } from './builds/builds.controller';
import { BuildsService } from './builds/builds.service';
import { CompareService } from './compare/compare.service';
import { DiffWorkerPool } from './compare/diff-worker-pool';
import { LookSameService } from './compare/libs/looks-same/looks-same.service';
import { OdiffService } from './compare/libs/odiff/odiff.service';
import { PixelmatchService } from './compare/libs/pixelmatch/pixelmatch.service';
import { GeminiService } from './compare/libs/vlm/providers/gemini/gemini.service';
import { OllamaController } from './compare/libs/vlm/providers/ollama/ollama.controller';
import { OllamaService } from './compare/libs/vlm/providers/ollama/ollama.service';
import { VlmService } from './compare/libs/vlm/vlm.service';
import { HealthController } from './health/health.controller';
import { PrismaService } from './prisma/prisma.service';
import { ProjectsController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';
import { EventsGateway } from './shared/events/events.gateway';
import { TasksService } from './shared/tasks/tasks.service';
import { HddService } from './static/hdd/hdd.service';
import { StaticController } from './static/static.controller';
import { StaticFactoryService } from './static/static.factory';
import { StaticService } from './static/static.service';
import { TestRunsController } from './test-runs/test-runs.controller';
import { TestRunsService } from './test-runs/test-runs.service';
import { TestVariationsController } from './test-variations/test-variations.controller';
import { TestVariationsService } from './test-variations/test-variations.service';
import { DbUsersService } from './users/db/dbusers.service';
import { UsersController } from './users/users.controller';
import { UsersFactoryService } from './users/users.factory';
import { UsersService } from './users/users.service';

jest.mock('./config/env.validation', () => {
  const actual = jest.requireActual('./config/env.validation');
  return { ...actual, validateEnv: jest.fn(actual.validateEnv) };
});

type PrismaMock = {
  onModuleInit: jest.Mock;
  onApplicationShutdown: jest.Mock;
  $connect: jest.Mock;
  $disconnect: jest.Mock;
  $runCommandRaw: jest.Mock;
  $queryRawUnsafe: jest.Mock;
  user: { findUnique: jest.Mock };
  project: { findMany: jest.Mock };
};

const createPrismaMock = (): PrismaMock => ({
  onModuleInit: jest.fn().mockResolvedValue(undefined),
  onApplicationShutdown: jest.fn().mockResolvedValue(undefined),
  $connect: jest.fn().mockResolvedValue(undefined),
  $disconnect: jest.fn().mockResolvedValue(undefined),
  $runCommandRaw: jest
    .fn()
    .mockRejectedValue(new Error('The postgresql provider does not support $runCommandRaw. Use the mongodb provider.')),
  $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  user: { findUnique: jest.fn().mockResolvedValue(null) },
  project: { findMany: jest.fn().mockResolvedValue([]) },
});

const TEST_ENV = {
  JWT_SECRET: 'app-module-spec-secret',
  JWT_LIFE_TIME: '1h',
  APP_FRONTEND_URL: 'http://localhost:8080',
  STATIC_SERVICE: 'hdd',
  OIDC_ENABLED: 'false',
  LDAP_ENABLED: 'false',
};

describe('AppModule', () => {
  const originalEnv = { ...process.env };
  const prismaInstances: PrismaMock[] = [];
  let moduleRef: TestingModule;
  let app: INestApplication;

  const get = <T>(token: Type<T>): T => moduleRef.get(token, { strict: false });
  const prismaOf = (instance: unknown): PrismaMock => (instance as { prismaService: PrismaMock }).prismaService;
  const inner = (token: Type<unknown>) => get<unknown>(token) as Record<string, unknown>;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    const { AppModule } = require('./app.module') as typeof import('./app.module');

    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useFactory({
        factory: () => {
          const prisma = createPrismaMock();
          prismaInstances.push(prisma);
          return prisma;
        },
      })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    process.env = originalEnv;
  });

  describe('dependency injection', () => {
    it.each<[string, Type<unknown>]>([
      ['AppService', AppService],
      ['ConfigService', ConfigService],
      ['JwtService', JwtService],
      ['AuthService', AuthService],
      ['JwtStrategy', JwtStrategy],
      ['ApiGuard', ApiGuard],
      ['JwtAuthGuard', JwtAuthGuard],
      ['UsersFactoryService', UsersFactoryService],
      ['UsersService', UsersService],
      ['BuildsService', BuildsService],
      ['ProjectsService', ProjectsService],
      ['TestRunsService', TestRunsService],
      ['TestVariationsService', TestVariationsService],
      ['CompareService', CompareService],
      ['DiffWorkerPool', DiffWorkerPool],
      ['PixelmatchService', PixelmatchService],
      ['LookSameService', LookSameService],
      ['OdiffService', OdiffService],
      ['VlmService', VlmService],
      ['OllamaService', OllamaService],
      ['GeminiService', GeminiService],
      ['StaticService', StaticService],
      ['StaticFactoryService', StaticFactoryService],
      ['HddService', HddService],
      ['EventsGateway', EventsGateway],
      ['TasksService', TasksService],
      ['SchedulerRegistry', SchedulerRegistry],
      ['HealthCheckService', HealthCheckService],
    ])('resolves the %s provider', (_name, token) => {
      expect(get(token)).toBeInstanceOf(token);
    });

    it.each<[string, Type<unknown>]>([
      ['HealthController', HealthController],
      ['UsersController', UsersController],
      ['BuildsController', BuildsController],
      ['ProjectsController', ProjectsController],
      ['TestRunsController', TestRunsController],
      ['TestVariationsController', TestVariationsController],
      ['OllamaController', OllamaController],
      ['StaticController', StaticController],
    ])('resolves the %s controller', (_name, token) => {
      expect(get(token)).toBeInstanceOf(token);
    });

    it('closes the forwardRef cycles between builds, projects, test runs and test variations', () => {
      const builds = inner(BuildsService);
      const projects = inner(ProjectsService);
      const testRuns = inner(TestRunsService);
      const testVariations = inner(TestVariationsService);
      const tasks = inner(TasksService);

      expect(builds.testRunsService).toBe(testRuns);
      expect(builds.eventsGateway).toBe(get(EventsGateway));
      expect(projects.staticService).toBe(get(StaticService));
      expect(projects.eventsGateway).toBe(get(EventsGateway));
      expect(testRuns.testVariationService).toBe(testVariations);
      expect(testRuns.compareService).toBe(get(CompareService));
      expect(testRuns.staticService).toBe(get(StaticService));
      expect(testVariations.testRunsService).toBe(testRuns);
      expect(testVariations.buildsService).toBe(builds);
      expect(tasks.testVariationService).toBe(testVariations);
    });

    it('shares one StaticModule between every importer', () => {
      expect(inner(VlmService).staticService).toBe(get(StaticService));
      expect(inner(TestVariationsService).staticService).toBe(get(StaticService));
    });

    it('picks the HDD storage and the DB users backend under the default configuration', () => {
      expect(inner(StaticService).staticService).toBeInstanceOf(HddService);
      expect(inner(UsersService).usersService).toBeInstanceOf(DbUsersService);
    });

    it('shares one PrismaService instance across the whole app', () => {
      expect(prismaInstances).toHaveLength(1);

      const consumers = [
        prismaOf(get(HealthController)),
        prismaOf(get(JwtStrategy)),
        prismaOf(get(EventsGateway)),
        prismaOf(get(BuildsService)),
        prismaOf(get(ProjectsService)),
        prismaOf(get(TestRunsService)),
        prismaOf(get(TestVariationsService)),
        inner(CompareService).prismaService,
        prismaOf(get(TasksService)),
      ];
      consumers.forEach((prisma) => expect(prisma).toBe(prismaInstances[0]));
    });
  });

  describe('configuration', () => {
    it('exposes the validated config through ConfigService', () => {
      expect(validateEnv).toHaveBeenCalledWith(expect.objectContaining({ JWT_SECRET: TEST_ENV.JWT_SECRET }));
      expect(get(ConfigService).get('JWT_LIFE_TIME')).toBe('1h');
    });
  });

  describe('lifecycle', () => {
    it('runs onModuleInit of every PrismaService on init', () => {
      prismaInstances.forEach((prisma) => expect(prisma.onModuleInit).toHaveBeenCalledTimes(1));
    });

    it('registers the midnight test-variation cleanup as the only cron job', () => {
      const jobs = get(SchedulerRegistry).getCronJobs();

      expect(jobs.size).toBe(1);
      const [job] = [...jobs.values()];
      expect(job.cronTime.source).toBe('0 0 * * *');
      expect(job.isActive).toBe(true);
    });

    it('applies the http server timeouts on bootstrap', () => {
      const server = get(HttpAdapterHost).httpAdapter.getHttpServer();

      expect(typeof server.timeout).toBe('number');
      expect(Number.isNaN(server.timeout)).toBe(false);
      expect(Number.isNaN(server.headersTimeout)).toBe(false);
      expect(Number.isNaN(server.keepAliveTimeout)).toBe(false);
    });
  });

  describe('http pipeline', () => {
    it('answers unknown routes with the JSON shape of the global HttpExceptionFilter', async () => {
      const response = await request(app.getHttpServer()).get('/does-not-exist');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        statusCode: 404,
        path: '/does-not-exist',
        name: 'NotFoundException',
        message: 'Cannot GET /does-not-exist',
      });
    });

    it('rejects a JWT-guarded route without a token', async () => {
      const response = await request(app.getHttpServer()).get('/projects');

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ name: 'UnauthorizedException', message: 'Unauthorized' });
    });

    it('lets a valid JWT through the passport jwt strategy', async () => {
      const user = { id: 'user-id', email: 'user@example.com' };
      prismaInstances.forEach((prisma) => prisma.user.findUnique.mockResolvedValue(user));
      const token = get(JwtService).sign({ email: user.email });

      const response = await request(app.getHttpServer()).get('/projects').set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
      expect(prismaOf(get(JwtStrategy)).user.findUnique).toHaveBeenCalledWith({ where: { email: user.email } });
      expect(prismaOf(get(ProjectsService)).project.findMany).toHaveBeenCalled();
    });

    it('serves the health check through the AppModule PrismaService', async () => {
      const response = await request(app.getHttpServer()).get('/health');

      expect(prismaOf(get(HealthController)).$queryRawUnsafe).toHaveBeenCalledWith('SELECT 1');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        info: { database: { status: 'up', responseTime: expect.any(Number) } },
        error: {},
        details: { database: { status: 'up', responseTime: expect.any(Number) } },
      });
    });

    it('answers 503 from the health check when the database query fails', async () => {
      prismaOf(get(HealthController)).$queryRawUnsafe.mockRejectedValueOnce(new Error('Can not reach database server'));

      const response = await request(app.getHttpServer()).get('/health');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        statusCode: 503,
        path: '/health',
        name: 'ServiceUnavailableException',
        message: 'Service Unavailable Exception',
      });
    });
  });

  describe('shutdown', () => {
    it('stops the cron jobs, the diff worker pool and every PrismaService on close', async () => {
      const [job] = [...get(SchedulerRegistry).getCronJobs().values()];
      const diffWorkerPool = get(DiffWorkerPool);
      const closeHttp = jest.spyOn(app.getHttpAdapter(), 'close');
      const stopWorkers = jest.spyOn(diffWorkerPool, 'onApplicationShutdown');

      await app.close();

      const httpClosedAt = closeHttp.mock.invocationCallOrder[0];
      expect(httpClosedAt).toBeDefined();
      expect(stopWorkers.mock.invocationCallOrder[0]).toBeGreaterThan(httpClosedAt);
      prismaInstances.forEach((prisma) =>
        expect(prisma.onApplicationShutdown.mock.invocationCallOrder[0]).toBeGreaterThan(httpClosedAt)
      );

      expect(job.isActive).toBe(false);
      expect(get(SchedulerRegistry).getCronJobs().size).toBe(0);
      expect((diffWorkerPool as unknown as { destroyed: boolean }).destroyed).toBe(true);
      prismaInstances.forEach((prisma) => expect(prisma.onApplicationShutdown).toHaveBeenCalledTimes(1));
    });
  });
});
