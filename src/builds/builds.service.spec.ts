import { Test, TestingModule } from '@nestjs/testing';
import { BuildsService } from './builds.service';
import { PrismaService } from '../prisma/prisma.service';
import { TestRunsService } from '../test-runs/test-runs.service';
import { EventsGateway } from '../shared/events/events.gateway';
import { CreateBuildDto } from './dto/build-create.dto';
import { Build, TestRun, Project, TestStatus } from '@prisma/client';
import { mocked } from 'ts-jest/utils';
import { BuildDto } from './dto/build.dto';
import { ProjectsService } from '../projects/projects.service';

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
    testRuns: [
      {
        id: '10fb5e02-64e0-4cf5-9f17-c00ab3c96658',
        imageName: '1592423768112.screenshot.png',
        diffName: null,
        diffPercent: null,
        diffTollerancePercent: 1,
        pixelMisMatchCount: null,
        status: 'new',
        buildId: '146e7a8d-89f0-4565-aa2c-e61efabb0afd',
        testVariationId: '3bc4a5bc-006e-4d43-8e4e-eaa132627fca',
        updatedAt: new Date(),
        createdAt: new Date(),
        name: 'ss2f77',
        browser: 'chromium',
        device: null,
        os: null,
        viewport: '1800x1600',
        customTags:'',
        baselineName: null,
        ignoreAreas: '[]',
        tempIgnoreAreas: '[]',
        comment: 'some comment',
        branchName: 'develop',
        baselineBranchName: 'master',
        merge: false,
      },
    ],
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
    mocked(BuildDto).mockReturnValueOnce(buildDto);
    service = await initService({ buildFindUniqueMock, testRunFindManyMock });

    const result = await service.findOne('someId');

    expect(mocked(BuildDto)).toHaveBeenCalledWith({ ...build, testRuns: build.testRuns });
    expect(result).toBe(buildDto);
  });

  it('findMany', async () => {
    const buildFindManyMock = jest.fn().mockResolvedValueOnce([build]);
    const buildCountMock = jest.fn().mockResolvedValueOnce(33);
    const projectId = 'someId';
    mocked(BuildDto).mockReturnValueOnce(buildDto);
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
    const buildDeleteMock = jest.fn();
    const testRunDeleteMock = jest.fn();
    service = await initService({ buildFindUniqueMock, buildDeleteMock, testRunDeleteMock });

    await service.remove(build.id);

    expect(buildFindUniqueMock).toHaveBeenCalledWith({
      where: { id: build.id },
      include: {
        testRuns: true,
      },
    });
    expect(testRunDeleteMock).toHaveBeenCalledWith(build.testRuns[0].id);
    expect(buildDeleteMock).toHaveBeenCalledWith({
      where: { id: build.id },
    });
  });

  it('should stop', async () => {
    const id = 'some id';
    const buildUpdateMock = jest.fn();
    const eventsBuildUpdatedMock = jest.fn();
    mocked(BuildDto).mockReturnValueOnce(buildDto);
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
});
