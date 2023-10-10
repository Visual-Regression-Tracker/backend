import { Test, TestingModule } from '@nestjs/testing';
import { BuildsService } from './builds.service';
import { PrismaService } from '../prisma/prisma.service';
import { TestRunsService } from '../test-runs/test-runs.service';
import { EventsGateway } from '../shared/events/events.gateway';
import { Build, TestRun, TestStatus } from '@prisma/client';
import { mocked, MockedObject } from 'jest-mock';
import { BuildDto } from './dto/build.dto';
import { ProjectsService } from '../projects/projects.service';
import { generateTestRun } from '../_data_';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

jest.mock('./dto/build.dto');

const initService = async ({
  buildFindManyMock = jest.fn(),
  buildCreateMock = jest.fn(),
  buildUpdateMock = jest.fn(),
  buildFindUniqueMock = jest.fn(),
  buildDeleteMock = jest.fn(),
  buildUpsertMock = jest.fn(),
  buildCountMock = jest.fn(),
  testRunDeleteMock = jest.fn(),
  testRunApproveMock = jest.fn(),
  testRunFindManyMock = jest.fn(),
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
            delete: buildDeleteMock,
            upsert: buildUpsertMock,
            count: buildCountMock,
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
    const testRunFindManyMock = jest.fn().mockResolvedValueOnce(build.testRuns);
    mocked(BuildDto).mockReturnValueOnce(buildDto as MockedObject<BuildDto>);
    service = await initService({ buildFindUniqueMock, testRunFindManyMock });

    const result = await service.findOne('someId');

    expect(mocked(BuildDto)).toHaveBeenCalledWith({ ...build, testRuns: build.testRuns });
    expect(result).toBe(buildDto);
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
      orderBy: { createdAt: 'desc' },
      where: { projectId },
    });
    expect(result).toEqual({
      data: [buildDto],
      total: 33,
      take: 10,
      skip: 20,
    });
  });

  it('delete', async () => {
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
