import { INestApplication, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { SchedulerRegistry } from '@nestjs/schedule';
import { HealthCheckService } from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppService } from './app.service';
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

// The point of this spec is to catch dependency-injection breakage when the
// framework is upgraded: every module, provider and controller of the real
// AppModule has to resolve, with only the database client swapped out.

type PrismaMock = {
  onModuleInit: jest.Mock;
  onModuleDestroy: jest.Mock;
  $connect: jest.Mock;
  $disconnect: jest.Mock;
  $queryRaw: jest.Mock;
  user: { findUnique: jest.Mock };
  project: { findMany: jest.Mock };
};

// a plain object rather than a PrismaService, so the lifecycle hooks are
// stand-ins: asserting they are called proves Nest still drives them
const createPrismaMock = (): PrismaMock => ({
  onModuleInit: jest.fn().mockResolvedValue(undefined),
  onModuleDestroy: jest.fn().mockResolvedValue(undefined),
  $connect: jest.fn().mockResolvedValue(undefined),
  $disconnect: jest.fn().mockResolvedValue(undefined),
  $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  user: { findUnique: jest.fn().mockResolvedValue(null) },
  project: { findMany: jest.fn().mockResolvedValue([]) },
});

// Pinned so a developer .env (S3 storage, OIDC/LDAP login) cannot make the
// wiring reach out to the network. ConfigModule never overwrites variables that
// are already set, so these win over the .env file.
const TEST_ENV = {
  JWT_SECRET: 'app-module-spec-secret',
  JWT_LIFE_TIME: '1h',
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

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    // imported only after the env is pinned: ConfigModule.forRoot() reads the
    // .env file at import time of the module that calls it
    // a plain require: under `module: nodenext` an import() stays a real ESM import
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
    // a no-op when the shutdown test below already closed the app
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
      const builds = get(BuildsService) as unknown as Record<string, unknown>;
      const projects = get(ProjectsService) as unknown as Record<string, unknown>;
      const testRuns = get(TestRunsService) as unknown as Record<string, unknown>;
      const testVariations = get(TestVariationsService) as unknown as Record<string, unknown>;
      const tasks = get(TasksService) as unknown as Record<string, unknown>;

      expect(builds.testRunsService).toBe(testRuns);
      expect(builds.eventsGateway).toBe(get(EventsGateway));
      expect(projects.buildsService).toBe(builds);
      expect(projects.testVariationsService).toBe(testVariations);
      expect(testRuns.testVariationService).toBe(testVariations);
      expect(testRuns.compareService).toBe(get(CompareService));
      expect(testRuns.staticService).toBe(get(StaticService));
      expect(testVariations.testRunsService).toBe(testRuns);
      expect(testVariations.buildsService).toBe(builds);
      expect(tasks.testVariationService).toBe(testVariations);
    });

    it('shares one StaticModule between every importer', () => {
      const vlm = get(VlmService) as unknown as Record<string, unknown>;
      const testVariations = get(TestVariationsService) as unknown as Record<string, unknown>;

      expect(vlm.staticService).toBe(get(StaticService));
      expect(testVariations.staticService).toBe(get(StaticService));
    });

    it('picks the HDD storage and the DB users backend under the default configuration', () => {
      expect((get(StaticService) as unknown as Record<string, unknown>).staticService).toBeInstanceOf(HddService);
      expect((get(UsersService) as unknown as Record<string, unknown>).usersService).toBeInstanceOf(DbUsersService);
    });

    // PrismaModule is global: every consumer shares one client and so one
    // connection pool per instance.
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
        (get(CompareService) as unknown as Record<string, unknown>).prismaService,
        prismaOf(get(TasksService)),
      ];
      consumers.forEach((prisma) => expect(prisma).toBe(prismaInstances[0]));
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
      expect(response.body).toMatchObject({
        path: '/does-not-exist',
        name: 'NotFoundException',
        message: 'Cannot GET /does-not-exist',
        exception: expect.objectContaining({ status: 404 }),
        stack: expect.stringContaining('NotFoundException'),
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

      expect(prismaOf(get(HealthController)).$queryRaw).toHaveBeenCalled();
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok', info: {}, error: {}, details: {} });
    });

    // NOTE: current behavior — a database failure surfaces as a 500 from the
    // global filter, not as terminus' 503 health report.
    it('answers 500 from the health check when the database query fails', async () => {
      prismaOf(get(HealthController)).$queryRaw.mockRejectedValueOnce(new Error('Can not reach database server'));

      const response = await request(app.getHttpServer()).get('/health');

      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({ path: '/health', name: 'Error', message: 'Can not reach database server' });
    });
  });

  // must stay the last block: it closes the application
  describe('shutdown', () => {
    it('stops the cron jobs, the diff worker pool and every PrismaService on close', async () => {
      const [job] = [...get(SchedulerRegistry).getCronJobs().values()];
      const diffWorkerPool = get(DiffWorkerPool);

      await app.close();

      expect(job.isActive).toBe(false);
      expect(get(SchedulerRegistry).getCronJobs().size).toBe(0);
      expect((diffWorkerPool as unknown as { destroyed: boolean }).destroyed).toBe(true);
      prismaInstances.forEach((prisma) => expect(prisma.onModuleDestroy).toHaveBeenCalledTimes(1));
    });
  });
});
