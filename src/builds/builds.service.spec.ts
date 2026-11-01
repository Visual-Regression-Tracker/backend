import { Test } from '@nestjs/testing';
import { BuildsService, retentionGraceMinutes } from './builds.service';
import { PrismaService } from '../prisma/prisma.service';
import { TestRunsService } from '../test-runs/test-runs.service';
import { EventsGateway } from '../shared/events/events.gateway';
import { Build, Prisma, TestRun, TestStatus } from '@prisma/client';
import { mocked, MockedObject } from 'jest-mock';
import { BuildDto } from './dto/build.dto';
import { ModifyBuildDto } from './dto/build-modify.dto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { StaticService } from '../static/static.service';
import { generateTestRun } from '../_data_';

const { PrismaClientKnownRequestError } = Prisma;

jest.mock('./dto/build.dto');

const prismaError = (code: string) => new PrismaClientKnownRequestError(code, { code, clientVersion: '5' });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const silentLogger = () => ({ warn: jest.fn(), debug: jest.fn(), log: jest.fn() });

const setup = async () => {
  const prisma = {
    project: { update: jest.fn() },
    build: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(async ({ where }): Promise<unknown> => ({ id: where.id })),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
      upsert: jest.fn(),
      count: jest.fn(),
      updateManyAndReturn: jest.fn(),
    },
    testRun: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  const events = {
    buildUpdated: jest.fn(),
    buildCreated: jest.fn(),
    buildDeleted: jest.fn(),
    testRunDeleted: jest.fn(),
  };
  const testRuns = { approve: jest.fn(), delete: jest.fn(), findMany: jest.fn() };
  const deleteImage = jest.fn().mockResolvedValue(true);

  const module = await Test.createTestingModule({
    providers: [
      BuildsService,
      { provide: PrismaService, useValue: prisma },
      { provide: TestRunsService, useValue: testRuns },
      { provide: EventsGateway, useValue: events },
      {
        provide: StaticService,
        useValue: {
          deleteImages: async (names: Iterable<string | null | undefined>) => {
            for (const name of names) if (name) await deleteImage(name);
          },
        },
      },
    ],
  }).compile();

  return { service: module.get(BuildsService), prisma, events, testRuns, deleteImage };
};

describe('BuildsService', () => {
  const build: Build & { testRuns: TestRun[] } = {
    id: 'a9385fc1-884d-4f9f-915e-40da0e7773d5',
    ciBuildId: null,
    number: null,
    branchName: 'develop',
    status: null,
    projectId: 'e0a37894-6f29-478d-b13e-6182fecc715e',
    updatedAt: new Date(),
    createdAt: new Date(),
    userId: null,
    isRunning: true,
    testRuns: [generateTestRun()],
  };
  const { testRuns: buildRuns, ...buildRow } = build;
  const [run] = buildRuns;

  const buildDto: BuildDto = {
    id: 'a9385fc1-884d-4f9f-915e-40da0e7773d5',
    ciBuildId: 'ciBuildId',
    number: null,
    branchName: 'develop',
    status: 'new',
    projectId: 'e0a37894-6f29-478d-b13e-6182fecc715e',
    updatedAt: new Date(),
    createdAt: new Date(),
    userId: null,
    passedCount: 0,
    unresolvedCount: 0,
    failedCount: 0,
    isRunning: true,
    merge: false,
  };
  const returnDtoOnce = () => mocked(BuildDto).mockReturnValueOnce(buildDto as MockedObject<BuildDto>);
  const buildOrder = [{ createdAt: 'desc' }, { id: 'desc' }];
  const unhandledRejections = () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    return { unhandled, stop: () => process.off('unhandledRejection', unhandled) };
  };

  it('findOne', async () => {
    const { service, prisma } = await setup();
    prisma.build.findUnique.mockResolvedValueOnce(build);
    prisma.testRun.groupBy.mockResolvedValueOnce([
      { buildId: 'someId', status: TestStatus.ok, merge: false, _count: { _all: 2 } },
      { buildId: 'someId', status: TestStatus.unresolved, merge: true, _count: { _all: 1 } },
    ]);
    returnDtoOnce();

    const result = await service.findOne('someId');

    expect(mocked(BuildDto)).toHaveBeenCalledWith(build, {
      passedCount: 2,
      unresolvedCount: 1,
      failedCount: 0,
      merge: true,
    });
    expect(result).toBe(buildDto);
  });

  it('findOne throws NotFoundException for an unknown id', async () => {
    const { service, prisma } = await setup();
    prisma.build.findUnique.mockResolvedValueOnce(null);

    await expect(service.findOne('missing')).rejects.toThrow(new NotFoundException('Build not found: missing'));
  });

  it('update writes only the columns a client may change', async () => {
    const { service, prisma } = await setup();
    service.findOne = jest.fn();

    await service.update('id', { isRunning: false, ciBuildId: 'ci', branchName: 'other' } as ModifyBuildDto);

    expect(prisma.build.update.mock.calls[0][0].data).toStrictEqual({ ciBuildId: 'ci', isRunning: false });
  });

  it('update announces the change and returns the build', async () => {
    const { service, prisma, events } = await setup();
    returnDtoOnce();

    const result = await service.update('some id', { isRunning: false });

    expect(prisma.build.update).toHaveBeenCalledWith({ where: { id: 'some id' }, data: { isRunning: false } });
    expect(events.buildUpdated).toHaveBeenCalledWith('some id');
    expect(result).toBe(buildDto);
  });

  describe('findMany', () => {
    const projectId = 'someId';
    const ciBuildId = { contains: 'Onboarding', mode: Prisma.QueryMode.insensitive };

    it('pages the builds of a project', async () => {
      const { service, prisma } = await setup();
      prisma.build.findMany.mockResolvedValueOnce([build]);
      prisma.build.count.mockResolvedValueOnce(33);
      returnDtoOnce();

      const result = await service.findMany(projectId, 10, 20);

      expect(prisma.build.count).toHaveBeenCalledWith({ where: { projectId } });
      expect(prisma.build.findMany).toHaveBeenCalledWith({
        take: 10,
        skip: 20,
        orderBy: buildOrder,
        where: { projectId },
      });
      expect(result).toEqual({ data: [buildDto], total: 33, take: 10, skip: 20 });
    });

    it.each([
      ['ciBuildId', 'Onboarding', { projectId, ciBuildId }],
      ['an empty ciBuildId', '', { projectId }],
    ])('filters by %s', async (_, search, where) => {
      const { service, prisma } = await setup();
      prisma.build.findMany.mockResolvedValueOnce([build]);
      prisma.build.count.mockResolvedValueOnce(1);
      returnDtoOnce();

      await service.findMany(projectId, 10, 0, search);

      expect(prisma.build.count).toHaveBeenCalledWith({ where });
      expect(prisma.build.findMany).toHaveBeenCalledWith({ take: 10, skip: 0, orderBy: buildOrder, where });
    });

    describe('around a build', () => {
      const aroundBuildId = '7428548b-863f-40e8-b26d-2187cc98afa1';
      const createdAt = new Date('2026-09-01T10:00:00.000Z');
      const ahead = [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: aroundBuildId } }];

      const around = async (found: unknown, counts: number[]) => {
        const ctx = await setup();
        ctx.prisma.build.findFirst.mockResolvedValueOnce(found);
        ctx.prisma.build.findMany.mockResolvedValueOnce([build]);
        counts.forEach((count) => ctx.prisma.build.count.mockResolvedValueOnce(count));
        returnDtoOnce();
        return ctx;
      };

      it('returns the page that holds the build rather than the one asked for', async () => {
        const { service, prisma } = await around({ id: aroundBuildId, createdAt }, [35, 50]);

        const result = await service.findMany(projectId, 10, 0, undefined, aroundBuildId);

        expect(prisma.build.findFirst).toHaveBeenCalledWith({
          where: { projectId, id: aroundBuildId },
          select: { id: true, createdAt: true },
        });
        expect(prisma.build.count).toHaveBeenNthCalledWith(1, { where: { projectId, OR: ahead } });
        expect(prisma.build.findMany).toHaveBeenCalledWith({
          take: 10,
          skip: 30,
          orderBy: buildOrder,
          where: { projectId },
        });
        expect(result.skip).toBe(30);
      });

      it('counts only what the search left, so the page matches the list on screen', async () => {
        const { service, prisma } = await around({ id: aroundBuildId, createdAt }, [2, 4]);

        await service.findMany(projectId, 2, 0, 'Onboarding', aroundBuildId);

        expect(prisma.build.findFirst).toHaveBeenCalledWith({
          where: { projectId, ciBuildId, id: aroundBuildId },
          select: { id: true, createdAt: true },
        });
        expect(prisma.build.count).toHaveBeenNthCalledWith(1, { where: { projectId, ciBuildId, OR: ahead } });
        expect(prisma.build.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 2 }));
      });

      it('falls back to the page asked for when the build is not in the list', async () => {
        const { service, prisma } = await around(null, [50]);

        const result = await service.findMany(projectId, 10, 20, undefined, aroundBuildId);

        expect(prisma.build.count).toHaveBeenCalledTimes(1);
        expect(prisma.build.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20 }));
        expect(result.skip).toBe(20);
      });

      it('does not divide by a page of no size', async () => {
        const { service, prisma } = await around({ id: aroundBuildId, createdAt }, [0]);

        const result = await service.findMany(projectId, 0, 0, undefined, aroundBuildId);

        expect(result.skip).toBe(0);
        expect(prisma.build.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
      });
    });
  });

  describe('remove', () => {
    const removedBuild = { ...buildRow, testRuns: [run] };

    it('removes a build, its runs, their files and announces it', async () => {
      const { service, prisma, events, testRuns, deleteImage } = await setup();
      prisma.build.findUnique.mockResolvedValueOnce(buildRow);
      prisma.build.delete.mockResolvedValueOnce(buildRow);
      prisma.testRun.findMany.mockResolvedValueOnce([run]);

      const result = await service.remove(build.id);

      expect(prisma.build.findUnique).toHaveBeenCalledWith({ where: { id: build.id } });
      expect(prisma.testRun.findMany).toHaveBeenCalledWith({ where: { buildId: build.id }, take: 500 });
      expect(prisma.testRun.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [run.id] } } });
      expect(deleteImage).toHaveBeenCalledTimes(2);
      expect(deleteImage).toHaveBeenCalledWith(run.imageName);
      expect(deleteImage).toHaveBeenCalledWith(run.diffName);
      expect(events.testRunDeleted).toHaveBeenCalledWith(run);
      expect(prisma.build.delete).toHaveBeenCalledWith({ where: { id: build.id } });
      expect(mocked(BuildDto).mock.calls.at(-1)).toEqual([removedBuild]);
      expect(events.buildDeleted).toHaveBeenCalledTimes(1);
      expect(result).toEqual(removedBuild);
      expect(testRuns.delete).not.toHaveBeenCalled();
    });

    it('deletes the rows of a chunk before its files', async () => {
      const { service, prisma, deleteImage } = await setup();
      const calls: string[] = [];
      prisma.build.findUnique.mockResolvedValueOnce(buildRow);
      prisma.testRun.findMany.mockResolvedValueOnce([run]);
      prisma.testRun.deleteMany.mockImplementation(async () => void calls.push('rows'));
      deleteImage.mockImplementation(async () => void calls.push('file'));

      await service.remove(build.id);

      expect(calls).toEqual(['rows', 'file', 'file']);
    });

    it('removes the runs chunk by chunk', async () => {
      const { service, prisma } = await setup();
      const a = generateTestRun({ id: 'a' });
      const b = generateTestRun({ id: 'b' });
      prisma.build.findUnique.mockResolvedValueOnce(buildRow);
      prisma.testRun.findMany.mockResolvedValueOnce([a]).mockResolvedValueOnce([b]);

      const result = await service.remove(build.id);

      expect(prisma.testRun.deleteMany).toHaveBeenCalledTimes(2);
      expect(prisma.testRun.deleteMany).toHaveBeenNthCalledWith(1, { where: { id: { in: ['a'] } } });
      expect(prisma.testRun.deleteMany).toHaveBeenNthCalledWith(2, { where: { id: { in: ['b'] } } });
      expect(result?.testRuns).toEqual([a, b]);
    });

    it('should handle undefined ID gracefully', async () => {
      const { service, prisma } = await setup();
      const warn = jest.fn();
      (service as any).logger = { warn };

      await service.remove(undefined as unknown as string);

      expect(warn).toHaveBeenCalledWith('Attempted to remove build with undefined ID.');
      expect(prisma.build.findUnique).not.toHaveBeenCalled();
    });

    it('does nothing when the build does not exist', async () => {
      const { service, prisma, events } = await setup();
      prisma.build.findUnique.mockResolvedValueOnce(null);

      await expect(service.remove('missing')).resolves.toBeUndefined();

      expect(prisma.build.delete).not.toHaveBeenCalled();
      expect(events.buildDeleted).not.toHaveBeenCalled();
    });

    it('treats a build deleted in the meantime (P2025) as done, without an event', async () => {
      const { service, prisma, events } = await setup();
      prisma.build.findUnique.mockResolvedValueOnce(buildRow);
      prisma.build.delete.mockRejectedValueOnce(prismaError('P2025'));
      prisma.testRun.findMany.mockResolvedValueOnce([run]);

      await expect(service.remove(build.id)).resolves.toBeUndefined();

      expect(prisma.testRun.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [run.id] } } });
      expect(events.buildDeleted).not.toHaveBeenCalled();
    });

    it.each([
      ['a Prisma error other than P2003 and P2025', prismaError('P2034')],
      ['any other error', new Error('connection lost')],
    ])('rethrows %s from build.delete and announces nothing', async (_, error) => {
      const { service, prisma, events } = await setup();
      prisma.build.findUnique.mockResolvedValueOnce(buildRow);
      prisma.build.delete.mockRejectedValueOnce(error);

      await expect(service.remove(build.id)).rejects.toBe(error);

      expect(prisma.build.delete).toHaveBeenCalledTimes(1);
      expect(events.buildDeleted).not.toHaveBeenCalled();
    });

    it('deletes a run that arrived meanwhile and retries (P2003)', async () => {
      const { service, prisma, events } = await setup();
      const r1 = generateTestRun({ id: 'r1' });
      const r2 = generateTestRun({ id: 'r2' });
      prisma.build.findUnique.mockResolvedValueOnce(buildRow);
      prisma.build.delete.mockRejectedValueOnce(prismaError('P2003')).mockResolvedValueOnce(buildRow);
      prisma.testRun.findMany.mockResolvedValueOnce([r1]).mockResolvedValueOnce([]).mockResolvedValueOnce([r2]);

      const result = await service.remove(build.id);

      expect(prisma.build.delete).toHaveBeenCalledTimes(2);
      expect(result?.testRuns).toEqual([r1, r2]);
      expect(events.buildDeleted).toHaveBeenCalledTimes(1);
    });

    it('answers 409 when runs keep arriving', async () => {
      const { service, prisma, events } = await setup();
      prisma.build.findUnique.mockResolvedValueOnce(buildRow);
      prisma.build.delete.mockRejectedValue(prismaError('P2003'));

      await expect(service.remove(build.id)).rejects.toThrow(ConflictException);

      expect(prisma.build.delete).toHaveBeenCalledTimes(3);
      expect(events.buildDeleted).not.toHaveBeenCalled();
    });

    it('skips the file names a run does not have', async () => {
      const { service, prisma, deleteImage } = await setup();
      prisma.build.findUnique.mockResolvedValueOnce(buildRow);
      prisma.testRun.findMany.mockResolvedValueOnce([
        generateTestRun({ imageName: null as unknown as string, diffName: null }),
      ]);

      await service.remove(build.id);

      expect(deleteImage).not.toHaveBeenCalled();
    });

    it('does not look at activity without a cutoff', async () => {
      const { service, prisma } = await setup();
      prisma.build.findUnique.mockResolvedValueOnce(buildRow);

      await service.remove(build.id);

      expect(prisma.build.findFirst).not.toHaveBeenCalled();
    });

    describe('only if the build is idle', () => {
      const since = new Date('2026-01-01T00:00:00Z');

      it('keeps a build in use: no rows, files or events', async () => {
        const { service, prisma, events, deleteImage } = await setup();
        prisma.build.findUnique.mockResolvedValueOnce(buildRow);
        prisma.build.findFirst.mockResolvedValue(null);
        prisma.testRun.findMany.mockResolvedValueOnce([run]);

        await expect(service.remove(build.id, { onlyIfIdleSince: since })).resolves.toBeUndefined();

        expect(prisma.testRun.deleteMany).not.toHaveBeenCalled();
        expect(deleteImage).not.toHaveBeenCalled();
        expect(prisma.build.delete).not.toHaveBeenCalled();
        expect(events.testRunDeleted).not.toHaveBeenCalled();
        expect(events.buildDeleted).not.toHaveBeenCalled();
      });

      it('stops when the build becomes active between chunks', async () => {
        const { service, prisma, events } = await setup();
        prisma.build.findUnique.mockResolvedValueOnce(buildRow);
        prisma.build.findFirst.mockResolvedValueOnce({ id: build.id }).mockResolvedValue(null);
        prisma.testRun.findMany.mockResolvedValueOnce([generateTestRun({ id: 'r1' })]);

        await expect(service.remove(build.id, { onlyIfIdleSince: since })).resolves.toBeUndefined();

        expect(prisma.testRun.deleteMany).toHaveBeenCalledTimes(1);
        expect(prisma.build.delete).not.toHaveBeenCalled();
        expect(events.buildDeleted).not.toHaveBeenCalled();
      });

      it('removes an idle build', async () => {
        const { service, prisma, events } = await setup();
        prisma.build.findUnique.mockResolvedValueOnce(buildRow);
        prisma.build.findFirst.mockResolvedValue({ id: build.id });
        prisma.build.delete.mockResolvedValueOnce(buildRow);
        prisma.testRun.findMany.mockResolvedValueOnce([run]);

        const result = await service.remove(build.id, { onlyIfIdleSince: since });

        expect(prisma.build.findFirst).toHaveBeenCalledWith({
          where: { id: build.id, updatedAt: { lt: since }, testRuns: { none: { createdAt: { gte: since } } } },
          select: { id: true },
        });
        expect(prisma.build.delete).toHaveBeenCalledWith({ where: { id: build.id } });
        expect(result).toEqual(removedBuild);
        expect(events.buildDeleted).toHaveBeenCalledTimes(1);
      });

      it('does not retry P2003 when pruning', async () => {
        const { service, prisma, events } = await setup();
        prisma.build.findUnique.mockResolvedValueOnce(buildRow);
        prisma.build.findFirst.mockResolvedValue({ id: build.id });
        prisma.build.delete.mockRejectedValue(prismaError('P2003'));

        await expect(service.remove(build.id, { onlyIfIdleSince: since })).resolves.toBeUndefined();

        expect(prisma.build.delete).toHaveBeenCalledTimes(1);
        expect(events.buildDeleted).not.toHaveBeenCalled();
      });
    });
  });

  describe('findOrCreate', () => {
    const params = { projectId: 'projectId', branchName: 'develop', ciBuildId: 'ci' };

    it('numbers a new build and announces it', async () => {
      const { service, prisma, events } = await setup();
      const numbered = { ...build, number: 3 };
      prisma.build.upsert.mockResolvedValueOnce(build);
      prisma.project.update.mockResolvedValueOnce({ buildsCounter: 3 });
      prisma.build.updateManyAndReturn.mockResolvedValueOnce([numbered]);

      const result = await service.findOrCreate(params);

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'projectId' },
        data: { buildsCounter: { increment: 1 } },
        select: { buildsCounter: true },
      });
      expect(prisma.build.updateManyAndReturn).toHaveBeenCalledWith({
        where: { id: build.id, number: null },
        data: { number: 3 },
      });
      expect(mocked(BuildDto).mock.calls.at(-1)).toEqual([numbered]);
      expect(events.buildCreated).toHaveBeenCalledTimes(1);
      expect(result).toBe(numbered);
    });

    it('numbers a new build once when parallel callers join it', async () => {
      const { service, prisma, events } = await setup();
      prisma.build.upsert.mockResolvedValue({ ...build, number: null });
      prisma.project.update.mockResolvedValueOnce({ buildsCounter: 42 }).mockResolvedValueOnce({ buildsCounter: 43 });
      prisma.build.updateManyAndReturn.mockResolvedValueOnce([{ ...build, number: 42 }]).mockResolvedValueOnce([]);
      prisma.build.findUniqueOrThrow.mockResolvedValue({ ...build, number: 42 });

      const results = await Promise.all([service.findOrCreate(params), service.findOrCreate(params)]);

      expect(events.buildCreated).toHaveBeenCalledTimes(1);
      expect(results.map((result) => result.number)).toEqual([42, 42]);
    });

    it('returns the build another caller numbered, without announcing it', async () => {
      const { service, prisma, events } = await setup();
      prisma.build.upsert.mockResolvedValueOnce(build);
      prisma.project.update.mockResolvedValueOnce({ buildsCounter: 8 });
      prisma.build.updateManyAndReturn.mockResolvedValueOnce([]);
      prisma.build.findUniqueOrThrow.mockResolvedValueOnce({ ...build, number: 7 });

      const result = await service.findOrCreate(params);

      expect(prisma.build.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: build.id } });
      expect(events.buildCreated).not.toHaveBeenCalled();
      expect(result).toEqual({ ...build, number: 7 });
    });

    it('rethrows a failure of the numbering transaction', async () => {
      const { service, prisma, events } = await setup();
      const error = new Error('connection lost');
      prisma.build.upsert.mockResolvedValueOnce(build);
      prisma.project.update.mockRejectedValueOnce(error);

      await expect(service.findOrCreate(params)).rejects.toBe(error);
      expect(events.buildCreated).not.toHaveBeenCalled();
    });

    it('retries a concurrent upsert (P2002) as an update with the same unique key', async () => {
      const { service, prisma } = await setup();
      prisma.build.upsert.mockRejectedValueOnce(prismaError('P2002'));
      prisma.build.update.mockResolvedValueOnce({ ...build, number: 9 });

      const result = await service.findOrCreate(params);

      expect(prisma.build.update).toHaveBeenCalledWith({
        where: { projectId_ciBuildId: { projectId: 'projectId', ciBuildId: 'ci' } },
        data: { isRunning: true },
      });
      expect(result).toEqual({ ...build, number: 9 });
    });

    it.each([
      ['another Prisma error', prismaError('P2003')],
      ['any other error', new Error('connection lost')],
    ])('rethrows %s from upsert unchanged', async (_, error) => {
      const { service, prisma } = await setup();
      prisma.build.upsert.mockRejectedValueOnce(error);

      await expect(service.findOrCreate(params)).rejects.toBe(error);
      expect(prisma.build.update).not.toHaveBeenCalled();
    });

    it.each([
      ['without ciBuildId', undefined, { id: '111' }],
      ['with ciBuildId', '222', { projectId_ciBuildId: { projectId: '111', ciBuildId: '222' } }],
    ])('upserts %s', async (_, ciBuildId, where) => {
      const { service, prisma } = await setup();
      prisma.build.upsert.mockResolvedValueOnce({ ...build, number: 1 });

      await service.findOrCreate({ projectId: '111', branchName: 'develop', ciBuildId });

      expect(prisma.build.upsert).toHaveBeenCalledWith({
        where,
        create: {
          branchName: 'develop',
          ...(ciBuildId && { ciBuildId }),
          isRunning: true,
          project: { connect: { id: '111' } },
        },
        update: { isRunning: true },
      });
    });

    it('leaves an already numbered build alone', async () => {
      const { service, prisma } = await setup();
      prisma.build.upsert.mockResolvedValueOnce({ ...build, number: 100 });

      const result = await service.findOrCreate({ projectId: '111', branchName: 'develop' });

      expect(prisma.project.update).not.toHaveBeenCalled();
      expect(result).toEqual({ ...build, number: 100 });
    });
  });

  describe('deleteOldBuilds', () => {
    const projectId = 'someProjectId';
    const ids = (...names: string[]) => names.map((id) => ({ id }));

    const init = async (oldBuilds: { id: string }[]) => {
      const ctx = await setup();
      ctx.prisma.build.findMany.mockResolvedValueOnce(oldBuilds);
      ctx.service.remove = jest.fn().mockResolvedValue(undefined);
      return ctx;
    };

    afterEach(() => {
      delete process.env.BUILD_RETENTION_GRACE_MINUTES;
      jest.useRealTimers();
    });

    it('removes every build past the newest maxBuildAllowed - 1, making room for the new one', async () => {
      const { service, prisma } = await init(ids('build1', 'build2'));

      await service.deleteOldBuilds(projectId, 3, 'b-new');

      expect(prisma.build.findMany).toHaveBeenCalledWith({
        where: { projectId, id: { not: 'b-new' } },
        orderBy: buildOrder,
        skip: 2,
        select: { id: true },
      });
      expect(service.remove).toHaveBeenCalledTimes(2);
      expect(service.remove).toHaveBeenCalledWith('build1', expect.anything());
      expect(service.remove).toHaveBeenCalledWith('build2', expect.anything());
    });

    it.each([[1], [0]])('with maxBuildAllowed=%p keeps no old build at all', async (max) => {
      const { service, prisma } = await init([]);

      await service.deleteOldBuilds(projectId, max, 'b-new');

      expect(prisma.build.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
    });

    it.each([
      [undefined, 60],
      ['', 60],
      ['15', 15],
      ['0', 0],
      ['-5', 60],
      ['abc', 60],
    ])('retentionGraceMinutes with %p is %p', (raw, expected) => {
      if (raw === undefined) {
        delete process.env.BUILD_RETENTION_GRACE_MINUTES;
      } else {
        process.env.BUILD_RETENTION_GRACE_MINUTES = raw;
      }

      expect(retentionGraceMinutes()).toBe(expected);
    });

    it('passes the grace cutoff to remove', async () => {
      jest.useFakeTimers({ now: new Date('2026-05-01T12:00:00Z'), doNotFake: ['setImmediate', 'nextTick'] });
      const { service } = await init(ids('build1'));

      await service.deleteOldBuilds(projectId, 1, 'b-new');

      expect(service.remove).toHaveBeenCalledWith('build1', { onlyIfIdleSince: new Date('2026-05-01T11:00:00Z') });
    });

    it('with grace 0 removes without the idle check', async () => {
      process.env.BUILD_RETENTION_GRACE_MINUTES = '0';
      const { service } = await init(ids('build1'));

      await service.deleteOldBuilds(projectId, 1, 'b-new');

      expect(service.remove).toHaveBeenCalledWith('build1', { onlyIfIdleSince: undefined });
    });

    it('runs a separate pruning for another kept build of the same project', async () => {
      const { service, prisma } = await setup();
      prisma.build.findMany.mockResolvedValue([]);

      await Promise.all([service.deleteOldBuilds(projectId, 2, 'b1'), service.deleteOldBuilds(projectId, 2, 'b2')]);

      expect(prisma.build.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.build.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ where: { projectId, id: { not: 'b1' } } })
      );
      expect(prisma.build.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ where: { projectId, id: { not: 'b2' } } })
      );
    });

    it('should handle concurrent calls for the same kept build by returning the existing promise', async () => {
      const { service, prisma } = await init(ids('build1'));

      const promise1 = service.deleteOldBuilds(projectId, 2, 'b-new');
      const promise2 = service.deleteOldBuilds(projectId, 2, 'b-new');

      expect(promise1).toStrictEqual(promise2);
      await promise1;
      expect(prisma.build.findMany).toHaveBeenCalledTimes(1);
      expect(service.remove).toHaveBeenCalledTimes(1);
    });

    it('should remove the promise from the map after completion (success)', async () => {
      const { service } = await init(ids('build1'));

      await service.deleteOldBuilds(projectId, 1, 'b-new');

      expect(service['ongoingDeletions'].has(`${projectId}|b-new`)).toBe(false);
    });

    it('one failing old build does not stop pruning the others', async () => {
      const { service } = await init(ids('old1', 'old2'));
      jest.mocked(service.remove).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);

      await expect(service.deleteOldBuilds(projectId, 1, 'b-new')).resolves.toBeUndefined();

      expect(service.remove).toHaveBeenCalledWith('old2', expect.anything());
    });

    it('hands a failure to the caller and leaves no unhandled rejection behind', async () => {
      const { unhandled, stop } = unhandledRejections();
      try {
        const { service, prisma } = await setup();
        prisma.build.findMany.mockRejectedValueOnce(new Error('db down'));

        await expect(service.deleteOldBuilds(projectId, 1, 'b-new')).rejects.toThrow('db down');
        await tick();

        expect(unhandled).not.toHaveBeenCalled();
        expect(service['ongoingDeletions'].has(`${projectId}|b-new`)).toBe(false);
      } finally {
        stop();
      }
    });
  });

  describe('background retention', () => {
    const projectId = 'someProjectId';

    it('scheduleRetention logs a failure instead of leaving it unhandled', async () => {
      const { unhandled, stop } = unhandledRejections();
      try {
        const { service, prisma } = await setup();
        prisma.build.findMany.mockRejectedValueOnce(new Error('db down'));
        const logger = silentLogger();
        (service as any).logger = logger;

        service.scheduleRetention(projectId, 1, 'b-new');
        await service.whenRetentionIdle();
        await tick();

        expect(unhandled).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
      } finally {
        stop();
      }
    });

    it('whenRetentionIdle resolves when nothing runs', async () => {
      const { service } = await setup();

      await expect(service.whenRetentionIdle()).resolves.toBeUndefined();
    });

    it('whenRetentionIdle waits for a running pruning, even a failing one', async () => {
      const { service, prisma } = await setup();
      let fail: (e: Error) => void = () => undefined;
      prisma.build.findMany.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
      (service as any).logger = silentLogger();
      service.scheduleRetention(projectId, 1, 'b-new');
      let idle = false;
      const waiting = service.whenRetentionIdle().then(() => (idle = true));

      await tick();
      expect(idle).toBe(false);
      fail(new Error('boom'));
      await waiting;

      expect(idle).toBe(true);
    });

    it('beforeApplicationShutdown stops between builds and waits', async () => {
      const { service, prisma } = await setup();
      prisma.build.findMany.mockResolvedValueOnce([{ id: 'o1' }, { id: 'o2' }]);
      let finishFirst: () => void = () => undefined;
      service.remove = jest
        .fn()
        .mockImplementationOnce(() => new Promise<undefined>((resolve) => (finishFirst = () => resolve(undefined))))
        .mockResolvedValue(undefined);
      service.scheduleRetention(projectId, 1, 'b-new');
      await tick();
      expect(service.remove).toHaveBeenCalledWith('o1', expect.anything());

      let stopped = false;
      const shutdown = service.beforeApplicationShutdown().then(() => (stopped = true));
      await tick();
      expect(stopped).toBe(false);
      finishFirst();
      await shutdown;

      expect(stopped).toBe(true);
      expect(service.remove).toHaveBeenCalledTimes(1);
      expect(service.remove).not.toHaveBeenCalledWith('o2', expect.anything());
    });
  });

  describe('approve', () => {
    it('approves the new and unresolved runs of the build', async () => {
      const { service, prisma, testRuns } = await setup();
      prisma.build.findUnique.mockResolvedValueOnce(build);
      testRuns.approve.mockResolvedValueOnce({ ...run, status: TestStatus.approved });

      await service.approve('someId', true, 'user id');

      expect(prisma.build.findUnique).toHaveBeenCalledWith({
        where: { id: 'someId' },
        include: {
          testRuns: {
            where: { status: { in: [TestStatus.new, TestStatus.unresolved] } },
            select: { id: true },
          },
        },
      });
      expect(testRuns.approve).toHaveBeenCalledWith(run.id, true, false, 'user id');
    });

    it('throws NotFoundException for an unknown build', async () => {
      const { service, prisma } = await setup();
      prisma.build.findUnique.mockResolvedValueOnce(null);

      await expect(service.approve('missing', false)).rejects.toThrow(
        new NotFoundException('Build not found: missing')
      );
    });
  });
});
