import { Test, TestingModule } from '@nestjs/testing';
import { BuildsService } from './builds.service';
import { PrismaService } from '../prisma/prisma.service';
import { TestRunsService } from '../test-runs/test-runs.service';
import { EventsGateway } from '../shared/events/events.gateway';
import { Build, Prisma, TestRun, TestStatus } from '@prisma/client';
import { mocked, MockedObject } from 'jest-mock';
import { BuildDto } from './dto/build.dto';
import { ModifyBuildDto } from './dto/build-modify.dto';
import { NotFoundException } from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import { generateTestRun, TEST_PROJECT } from '../_data_';
import { Prisma as PrismaRuntime } from '@prisma/client';
const { PrismaClientKnownRequestError } = PrismaRuntime;

jest.mock('./dto/build.dto');

const initService = async ({
  buildFindManyMock = jest.fn(),
  buildCreateMock = jest.fn(),
  buildUpdateMock = jest.fn(),
  // a row for whatever id is asked: findOne answers 404 for a missing build
  buildFindUniqueMock = jest.fn().mockImplementation(async ({ where }) => ({ id: where.id })),
  buildFindFirstMock = jest.fn(),
  buildDeleteMock = jest.fn(),
  buildUpsertMock = jest.fn(),
  buildCountMock = jest.fn(),
  testRunDeleteMock = jest.fn(),
  testRunApproveMock = jest.fn(),
  testRunFindManyMock = jest.fn(),
  testRunGroupByMock = jest.fn().mockResolvedValue([]),
  eventsBuildUpdatedMock = jest.fn(),
  eventsBuildCreatedMock = jest.fn(),
  eventBuildDeletedMock = jest.fn(),
  projectFindOneMock = jest.fn(),
  projectUpdateMock = jest.fn(),
}) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      BuildsService,
      {
        provide: PrismaService,
        useValue: {
          project: {
            update: projectUpdateMock,
          },
          build: {
            findMany: buildFindManyMock,
            create: buildCreateMock,
            update: buildUpdateMock,
            findUnique: buildFindUniqueMock,
            findFirst: buildFindFirstMock,
            delete: buildDeleteMock,
            upsert: buildUpsertMock,
            count: buildCountMock,
          },
          testRun: {
            groupBy: testRunGroupByMock,
          },
        },
      },
      {
        provide: TestRunsService,
        useValue: {
          approve: testRunApproveMock,
          delete: testRunDeleteMock,
          findMany: testRunFindManyMock,
        },
      },
      {
        provide: EventsGateway,
        useValue: {
          buildUpdated: eventsBuildUpdatedMock,
          buildCreated: eventsBuildCreatedMock,
          buildDeleted: eventBuildDeletedMock,
        },
      },
      {
        provide: ProjectsService,
        useValue: {
          findOne: projectFindOneMock,
        },
      },
    ],
  }).compile();

  return module.get<BuildsService>(BuildsService);
};

describe('BuildsService', () => {
  let service: BuildsService;

  const build: Build & {
    testRuns: TestRun[];
  } = {
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

  it('findOne', async () => {
    const buildFindUniqueMock = jest.fn().mockResolvedValueOnce(build);
    const testRunGroupByMock = jest
      .fn()
      .mockResolvedValueOnce([
        { buildId: 'someId', status: TestStatus.ok, _count: { _all: 2 } },
        { buildId: 'someId', status: TestStatus.unresolved, _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([{ buildId: 'someId' }]);
    mocked(BuildDto).mockReturnValueOnce(buildDto as MockedObject<BuildDto>);
    service = await initService({ buildFindUniqueMock, testRunGroupByMock });

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
    const buildFindUniqueMock = jest.fn().mockResolvedValueOnce(null);
    const testRunGroupByMock = jest.fn().mockResolvedValue([]);
    service = await initService({ buildFindUniqueMock, testRunGroupByMock });

    await expect(service.findOne('missing')).rejects.toThrow(new NotFoundException('Build not found: missing'));
  });

  it('update writes only the columns a client may change', async () => {
    const buildUpdateMock = jest.fn();
    service = await initService({ buildUpdateMock, eventsBuildUpdatedMock: jest.fn() });
    service.findOne = jest.fn();

    await service.update('id', { isRunning: false, ciBuildId: 'ci', branchName: 'other' } as ModifyBuildDto);

    expect(buildUpdateMock.mock.calls[0][0].data).toStrictEqual({ ciBuildId: 'ci', isRunning: false });
  });

  it('findMany', async () => {
    const buildFindManyMock = jest.fn().mockResolvedValueOnce([build]);
    const buildCountMock = jest.fn().mockResolvedValueOnce(33);
    const projectId = 'someId';
    mocked(BuildDto).mockReturnValueOnce(buildDto as MockedObject<BuildDto>);
    service = await initService({ buildFindManyMock, buildCountMock });

    const result = await service.findMany(projectId, 10, 20);

    expect(buildCountMock).toHaveBeenCalledWith({
      where: { projectId },
    });
    expect(buildFindManyMock).toHaveBeenCalledWith({
      take: 10,
      skip: 20,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: { projectId },
    });
    expect(result).toEqual({
      data: [buildDto],
      total: 33,
      take: 10,
      skip: 20,
    });
  });

  it('findMany filtered by ciBuildId', async () => {
    const buildFindManyMock = jest.fn().mockResolvedValueOnce([build]);
    const buildCountMock = jest.fn().mockResolvedValueOnce(1);
    const projectId = 'someId';
    mocked(BuildDto).mockReturnValueOnce(buildDto as MockedObject<BuildDto>);
    service = await initService({ buildFindManyMock, buildCountMock });

    await service.findMany(projectId, 10, 0, 'Onboarding');

    const where = {
      projectId,
      ciBuildId: { contains: 'Onboarding', mode: Prisma.QueryMode.insensitive },
    };
    expect(buildCountMock).toHaveBeenCalledWith({ where });
    expect(buildFindManyMock).toHaveBeenCalledWith({
      take: 10,
      skip: 0,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where,
    });
  });

  it('findMany ignores an empty ciBuildId', async () => {
    const buildFindManyMock = jest.fn().mockResolvedValueOnce([build]);
    const buildCountMock = jest.fn().mockResolvedValueOnce(33);
    const projectId = 'someId';
    mocked(BuildDto).mockReturnValueOnce(buildDto as MockedObject<BuildDto>);
    service = await initService({ buildFindManyMock, buildCountMock });

    await service.findMany(projectId, 10, 0, '');

    expect(buildCountMock).toHaveBeenCalledWith({ where: { projectId } });
    expect(buildFindManyMock).toHaveBeenCalledWith({
      take: 10,
      skip: 0,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: { projectId },
    });
  });

  describe('findMany around a build', () => {
    const aroundBuildId = '7428548b-863f-40e8-b26d-2187cc98afa1';
    const createdAt = new Date('2026-09-01T10:00:00.000Z');
    const projectId = 'someId';

    it('returns the page that holds the build rather than the one asked for', async () => {
      const buildFindFirstMock = jest.fn().mockResolvedValueOnce({ id: aroundBuildId, createdAt });
      const buildFindManyMock = jest.fn().mockResolvedValueOnce([build]);
      // 35 builds sit ahead of it, then the total
      const buildCountMock = jest.fn().mockResolvedValueOnce(35).mockResolvedValueOnce(50);
      mocked(BuildDto).mockReturnValueOnce(buildDto as MockedObject<BuildDto>);
      service = await initService({ buildFindFirstMock, buildFindManyMock, buildCountMock });

      const result = await service.findMany(projectId, 10, 0, undefined, aroundBuildId);

      expect(buildFindFirstMock).toHaveBeenCalledWith({
        where: { projectId, id: aroundBuildId },
        select: { id: true, createdAt: true },
      });
      expect(buildCountMock).toHaveBeenNthCalledWith(1, {
        where: {
          projectId,
          OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: aroundBuildId } }],
        },
      });
      // the fourth page of ten starts at 30, and 35 is on it
      expect(buildFindManyMock).toHaveBeenCalledWith({
        take: 10,
        skip: 30,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        where: { projectId },
      });
      expect(result.skip).toBe(30);
    });

    it('counts only what the search left, so the page matches the list on screen', async () => {
      const buildFindFirstMock = jest.fn().mockResolvedValueOnce({ id: aroundBuildId, createdAt });
      const buildFindManyMock = jest.fn().mockResolvedValueOnce([build]);
      const buildCountMock = jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(4);
      mocked(BuildDto).mockReturnValueOnce(buildDto as MockedObject<BuildDto>);
      service = await initService({ buildFindFirstMock, buildFindManyMock, buildCountMock });

      await service.findMany(projectId, 2, 0, 'Onboarding', aroundBuildId);

      const ciBuildId = { contains: 'Onboarding', mode: Prisma.QueryMode.insensitive };
      expect(buildFindFirstMock).toHaveBeenCalledWith({
        where: { projectId, ciBuildId, id: aroundBuildId },
        select: { id: true, createdAt: true },
      });
      expect(buildCountMock).toHaveBeenNthCalledWith(1, {
        where: {
          projectId,
          ciBuildId,
          OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: aroundBuildId } }],
        },
      });
      expect(buildFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ skip: 2 }));
    });

    it('falls back to the page asked for when the build is not in the list', async () => {
      // deleted, another project's, or filtered out by the search: a stale link
      // should still open the list rather than fail
      const buildFindFirstMock = jest.fn().mockResolvedValueOnce(null);
      const buildFindManyMock = jest.fn().mockResolvedValueOnce([build]);
      const buildCountMock = jest.fn().mockResolvedValueOnce(50);
      mocked(BuildDto).mockReturnValueOnce(buildDto as MockedObject<BuildDto>);
      service = await initService({ buildFindFirstMock, buildFindManyMock, buildCountMock });

      const result = await service.findMany(projectId, 10, 20, undefined, aroundBuildId);

      expect(buildCountMock).toHaveBeenCalledTimes(1);
      expect(buildFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ skip: 20 }));
      expect(result.skip).toBe(20);
    });

    it('does not divide by a page of no size', async () => {
      const buildFindFirstMock = jest.fn().mockResolvedValueOnce({ id: aroundBuildId, createdAt });
      const buildFindManyMock = jest.fn().mockResolvedValueOnce([build]);
      const buildCountMock = jest.fn().mockResolvedValueOnce(0);
      mocked(BuildDto).mockReturnValueOnce(buildDto as MockedObject<BuildDto>);
      service = await initService({ buildFindFirstMock, buildFindManyMock, buildCountMock });

      const result = await service.findMany(projectId, 0, 0, undefined, aroundBuildId);

      expect(result.skip).toBe(0);
      expect(buildFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
    });
  });

  describe('remove', () => {
    it('should remove a build successfully', async () => {
      const buildFindUniqueMock = jest.fn().mockResolvedValueOnce(build);
      const buildFindManyMock = jest.fn().mockImplementation(() => Promise.resolve(build));
      const buildDeleteMock = jest.fn().mockImplementation(() => Promise.resolve(build));
      const testRunDeleteMock = jest.fn();
      const eventBuildDeletedMock = jest.fn();
      service = await initService({
        buildFindUniqueMock,
        buildDeleteMock,
        testRunDeleteMock,
        eventBuildDeletedMock,
        buildFindManyMock,
      });

      await service.remove(build.id);

      expect(buildFindUniqueMock).toHaveBeenCalledWith({
        where: { id: build.id },
        include: {
          testRuns: true,
        },
      });
      expect(testRunDeleteMock).toHaveBeenCalledWith(build.testRuns[0].id);
      expect(eventBuildDeletedMock).toHaveBeenCalledWith(new BuildDto(build));
      expect(buildDeleteMock).toHaveBeenCalledWith({
        where: { id: build.id },
      });
    });

    it('should handle undefined ID gracefully', async () => {
      const buildFindUniqueMock = jest.fn();
      const loggerWarnMock = jest.fn();
      service = await initService({ buildFindUniqueMock });
      (service as any).logger = { warn: loggerWarnMock }; // Mock the logger

      await service.remove(undefined);

      expect(loggerWarnMock).toHaveBeenCalledWith('Attempted to remove build with undefined ID.');
      expect(buildFindUniqueMock).not.toHaveBeenCalled();
    });
  });

  describe('remove (characterization)', () => {
    it('does nothing when the build does not exist', async () => {
      const buildFindUniqueMock = jest.fn().mockResolvedValueOnce(null);
      const buildDeleteMock = jest.fn();
      const eventBuildDeletedMock = jest.fn();
      service = await initService({ buildFindUniqueMock, buildDeleteMock, eventBuildDeletedMock });

      await expect(service.remove('missing')).resolves.toBeUndefined();

      expect(buildDeleteMock).not.toHaveBeenCalled();
      expect(eventBuildDeletedMock).not.toHaveBeenCalled();
    });

    it('treats a build deleted in the meantime (P2025) as done, without an event', async () => {
      const buildFindUniqueMock = jest.fn().mockResolvedValueOnce(build);
      const buildDeleteMock = jest
        .fn()
        .mockRejectedValueOnce(new PrismaClientKnownRequestError('gone', { code: 'P2025', clientVersion: '5' }));
      const testRunDeleteMock = jest.fn();
      const eventBuildDeletedMock = jest.fn();
      service = await initService({ buildFindUniqueMock, buildDeleteMock, testRunDeleteMock, eventBuildDeletedMock });

      await expect(service.remove(build.id)).resolves.toBeUndefined();

      expect(testRunDeleteMock).toHaveBeenCalledWith(build.testRuns[0].id);
      expect(eventBuildDeletedMock).not.toHaveBeenCalled();
    });

    it.each([
      ['another Prisma error', new PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '5' })],
      ['any other error', new Error('connection lost')],
    ])('swallows %s on delete and still reports the build as deleted', async (_, error) => {
      const buildFindUniqueMock = jest.fn().mockResolvedValueOnce(build);
      const buildDeleteMock = jest.fn().mockRejectedValueOnce(error);
      const eventBuildDeletedMock = jest.fn();
      service = await initService({ buildFindUniqueMock, buildDeleteMock, eventBuildDeletedMock });

      const result = await service.remove(build.id);

      // NOTE: current behavior — only P2025 is handled; every other delete error
      // is swallowed and the build is announced as deleted although it is not.
      expect(result).toBe(build);
      expect(eventBuildDeletedMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('incrementBuildNumber', () => {
    it("bumps the project's build counter and gives the build the new number", async () => {
      const projectUpdateMock = jest.fn().mockResolvedValueOnce({ ...TEST_PROJECT, buildsCounter: 43 });
      const buildUpdateMock = jest.fn().mockResolvedValueOnce({ ...build, number: 43 });
      service = await initService({ projectUpdateMock, buildUpdateMock });

      const result = await service.incrementBuildNumber(build.id, 'projectId');

      expect(projectUpdateMock).toHaveBeenCalledWith({
        where: { id: 'projectId' },
        data: { buildsCounter: { increment: 1 } },
      });
      expect(buildUpdateMock).toHaveBeenCalledWith({ where: { id: build.id }, data: { number: 43 } });
      expect(result).toEqual({ ...build, number: 43 });
    });
  });

  describe('findOrCreate (characterization)', () => {
    it('numbers a new build and announces it', async () => {
      const numbered = { ...build, number: 3 };
      const buildUpsertMock = jest.fn().mockResolvedValueOnce(build);
      const eventsBuildCreatedMock = jest.fn();
      service = await initService({ buildUpsertMock, eventsBuildCreatedMock });
      service.incrementBuildNumber = jest.fn().mockResolvedValueOnce(numbered);

      const result = await service.findOrCreate({ projectId: 'projectId', branchName: 'develop', ciBuildId: 'ci' });

      expect(service.incrementBuildNumber).toHaveBeenCalledWith(build.id, 'projectId');
      expect(eventsBuildCreatedMock).toHaveBeenCalledWith(new BuildDto(numbered));
      expect(result).toBe(numbered);
    });

    it('retries a concurrent upsert (P2002) as an update with the same unique key', async () => {
      const buildUpsertMock = jest
        .fn()
        .mockRejectedValueOnce(new PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' }));
      const buildUpdateMock = jest.fn().mockResolvedValueOnce({ ...build, number: 9 });
      service = await initService({ buildUpsertMock, buildUpdateMock });

      const result = await service.findOrCreate({ projectId: 'projectId', branchName: 'develop', ciBuildId: 'ci' });

      expect(buildUpdateMock).toHaveBeenCalledWith({
        where: { projectId_ciBuildId: { projectId: 'projectId', ciBuildId: 'ci' } },
        data: { isRunning: true },
      });
      expect(result).toEqual({ ...build, number: 9 });
    });

    it.each([
      ['another Prisma error', new PrismaClientKnownRequestError('x', { code: 'P2003', clientVersion: '5' })],
      ['any other error', new Error('connection lost')],
    ])('turns %s on upsert into a TypeError', async (_, error) => {
      const buildUpsertMock = jest.fn().mockRejectedValueOnce(error);
      const buildUpdateMock = jest.fn();
      service = await initService({ buildUpsertMock, buildUpdateMock });

      // NOTE: current behavior — the original error is swallowed and the
      // undefined build is dereferenced afterwards
      await expect(
        service.findOrCreate({ projectId: 'projectId', branchName: 'develop', ciBuildId: 'ci' })
      ).rejects.toThrow(TypeError);
      expect(buildUpdateMock).not.toHaveBeenCalled();
    });
  });

  describe('deleteOldBuilds', () => {
    const projectId = 'someProjectId';
    const build1 = { ...buildDto, id: 'build1', createdAt: new Date(Date.now() - 10000) };
    const build2 = { ...buildDto, id: 'build2', createdAt: new Date(Date.now() - 5000) };

    it('should delete old builds and keep the specified number', async () => {
      const buildFindManyMock = jest.fn().mockResolvedValueOnce([build1, build2]);
      const buildCountMock = jest.fn().mockResolvedValueOnce(2);
      const buildFindUniqueMock = jest.fn().mockResolvedValueOnce(build1).mockResolvedValueOnce(build2);
      mocked(BuildDto)
        .mockReturnValueOnce(build1 as MockedObject<BuildDto>)
        .mockReturnValueOnce(build2 as MockedObject<BuildDto>);
      const testRunFindManyMock = jest.fn().mockResolvedValue([]);
      const removeMock = jest.fn().mockResolvedValue(undefined);
      const loggerDebugMock = jest.fn();

      service = await initService({ buildFindManyMock, buildCountMock, buildFindUniqueMock, testRunFindManyMock });
      service.remove = removeMock;
      (service as any).logger = { debug: loggerDebugMock };

      await service.deleteOldBuilds(projectId, 2);

      expect(buildFindManyMock).toHaveBeenCalledWith({
        where: { projectId },
        take: undefined,
        skip: 1,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      expect(removeMock).toHaveBeenCalledTimes(2);
      expect(removeMock).toHaveBeenCalledWith(build1.id);
      expect(removeMock).toHaveBeenCalledWith(build2.id);
      expect(loggerDebugMock).toHaveBeenCalledWith(
        `Starting to delete old builds for project ${projectId}, keeping 2 builds.`
      );
      expect(loggerDebugMock).toHaveBeenCalledWith(`Finished deleting old builds for project ${projectId}.`);
    });

    it('should handle concurrent calls for the same project by returning the existing promise', async () => {
      const buildFindManyMock = jest.fn().mockResolvedValueOnce([build1, build2]);
      const buildCountMock = jest.fn().mockResolvedValueOnce(2);
      const removeMock = jest.fn().mockResolvedValue(undefined);
      const testRunFindManyMock = jest.fn().mockResolvedValue([]);
      const buildFindUniqueMock = jest.fn().mockResolvedValueOnce(build1).mockResolvedValueOnce(build2);
      mocked(BuildDto)
        .mockReturnValueOnce(build1 as MockedObject<BuildDto>)
        .mockReturnValueOnce(build2 as MockedObject<BuildDto>);
      const loggerDebugMock = jest.fn();

      service = await initService({ buildFindManyMock, buildCountMock, testRunFindManyMock, buildFindUniqueMock });
      service.remove = removeMock;
      (service as any).logger = { debug: loggerDebugMock };

      const promise1 = service.deleteOldBuilds(projectId, 2);
      const promise2 = service.deleteOldBuilds(projectId, 2);

      expect(promise1).toStrictEqual(promise2);
      expect(loggerDebugMock).toHaveBeenCalledWith(
        `Deletion for project ${projectId} is already in progress. Returning existing promise.`
      );

      await promise1; // Wait for the deletion to complete

      expect(buildFindManyMock).toHaveBeenCalledTimes(1); // Only called once
      expect(removeMock).toHaveBeenCalledTimes(2);
      expect(loggerDebugMock).toHaveBeenCalledWith(`Finished deleting old builds for project ${projectId}.`);
    });

    it('should remove the promise from the map after completion (success)', async () => {
      const buildFindManyMock = jest.fn().mockResolvedValueOnce([build1]);
      const buildCountMock = jest.fn().mockResolvedValueOnce(1);
      const buildFindUniqueMock = jest.fn().mockResolvedValueOnce(build1);
      const removeMock = jest.fn().mockResolvedValue(undefined);

      service = await initService({ buildFindManyMock, buildCountMock, buildFindUniqueMock });
      service.remove = removeMock;

      const projectId = 'testProject';
      await service.deleteOldBuilds(projectId, 0);

      expect(service['ongoingDeletions'].has(projectId)).toBe(false);
    });
  });

  it('should stop', async () => {
    const id = 'some id';
    const buildUpdateMock = jest.fn();
    const eventsBuildUpdatedMock = jest.fn();
    mocked(BuildDto).mockReturnValueOnce(buildDto as MockedObject<BuildDto>);
    service = await initService({ buildUpdateMock, eventsBuildUpdatedMock });

    const result = await service.update(id, { isRunning: false });

    expect(buildUpdateMock).toHaveBeenCalledWith({
      where: { id },
      data: { isRunning: false },
    });
    expect(eventsBuildUpdatedMock).toHaveBeenCalledWith(id);
    expect(result).toBe(buildDto);
  });

  it('approve', async () => {
    const buildFindUniqueMock = jest.fn().mockResolvedValueOnce(build);
    const testRunApproveMock = jest.fn().mockResolvedValueOnce({
      ...build.testRuns[0],
      status: TestStatus.approved,
    });
    service = await initService({ buildFindUniqueMock, testRunApproveMock });
    service.findOne = jest.fn();

    await service.approve('someId', true);

    expect(buildFindUniqueMock).toHaveBeenCalledWith({
      where: { id: 'someId' },
      include: {
        testRuns: {
          where: {
            status: {
              in: [TestStatus.new, TestStatus.unresolved],
            },
          },
        },
      },
    });
    expect(testRunApproveMock).toHaveBeenCalledWith(build.testRuns[0].id, true);
  });

  it('approve throws NotFoundException for an unknown build', async () => {
    const buildFindUniqueMock = jest.fn().mockResolvedValueOnce(null);
    service = await initService({ buildFindUniqueMock });

    await expect(service.approve('missing', false)).rejects.toThrow(new NotFoundException('Build not found: missing'));
  });

  describe('findOsCreate', () => {
    it('create without ciBuildId', async () => {
      const buildUpsertMock = jest.fn().mockResolvedValueOnce(build);

      service = await initService({ buildUpsertMock });
      service.incrementBuildNumber = jest.fn().mockResolvedValueOnce(build);

      await service.findOrCreate({
        projectId: '111',
        branchName: 'develop',
      });

      expect(buildUpsertMock).toHaveBeenCalledWith({
        where: {
          id: '111',
        },
        create: {
          branchName: 'develop',
          isRunning: true,
          project: {
            connect: {
              id: '111',
            },
          },
        },
        update: {
          isRunning: true,
        },
      });
    });

    it('create with ciBuildId', async () => {
      const buildUpsertMock = jest.fn().mockResolvedValueOnce(build);
      service = await initService({ buildUpsertMock });
      service.incrementBuildNumber = jest.fn().mockResolvedValueOnce(build);

      await service.findOrCreate({
        projectId: '111',
        branchName: 'develop',
        ciBuildId: '222',
      });

      expect(buildUpsertMock).toHaveBeenCalledWith({
        where: {
          projectId_ciBuildId: {
            projectId: '111',
            ciBuildId: '222',
          },
        },
        create: {
          branchName: 'develop',
          ciBuildId: '222',
          isRunning: true,
          project: {
            connect: {
              id: '111',
            },
          },
        },
        update: {
          isRunning: true,
        },
      });
    });

    it('create with retry', async () => {
      const buildUpsertMock = jest
        .fn()
        .mockRejectedValueOnce(new PrismaClientKnownRequestError('mock error', { code: 'P2002', clientVersion: '5' }));
      const buildUpdateMock = jest.fn().mockResolvedValueOnce(build);
      service = await initService({ buildUpsertMock, buildUpdateMock });
      service.incrementBuildNumber = jest.fn().mockResolvedValueOnce(build);

      const result = await service.findOrCreate({
        projectId: '111',
        branchName: 'develop',
      });

      expect(result).toEqual(build);
    });

    it('update already created', async () => {
      const buildUpsertMock = jest.fn().mockResolvedValueOnce({
        ...build,
        number: 100,
      });
      service = await initService({ buildUpsertMock });
      service.incrementBuildNumber = jest.fn();

      const result = await service.findOrCreate({
        projectId: '111',
        branchName: 'develop',
      });

      expect(service.incrementBuildNumber).toHaveBeenCalledTimes(0);
      expect(result).toEqual({
        ...build,
        number: 100,
      });
    });
  });
});
