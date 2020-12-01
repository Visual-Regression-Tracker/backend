import { Test, TestingModule } from '@nestjs/testing';
import { BuildsService } from './builds.service';
import { PrismaService } from '../prisma/prisma.service';
import { TestRunsService } from '../test-runs/test-runs.service';
import { EventsGateway } from '../shared/events/events.gateway';
import { CreateBuildDto } from './dto/build-create.dto';
import { Build, TestRun, Project } from '@prisma/client';
import { mocked } from 'ts-jest/utils';
import { BuildDto } from './dto/build.dto';
import { ProjectsService } from '../projects/projects.service';

jest.mock('./dto/build.dto');

const initService = async ({
  buildFindManyMock = jest.fn(),
  buildCreateMock = jest.fn(),
  buildUpdateMock = jest.fn(),
  buildFindOneMock = jest.fn(),
  buildDeleteMock = jest.fn(),
  buildUpsertMock = jest.fn(),
  testRunDeleteMock = jest.fn(),
  eventsBuildCreatedMock = jest.fn(),
  eventsBuildFinishedMock = jest.fn(),
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
            findOne: buildFindOneMock,
            delete: buildDeleteMock,
            upsert: buildUpsertMock,
          },
        },
      },
      {
        provide: TestRunsService,
        useValue: {
          delete: testRunDeleteMock,
        },
      },
      {
        provide: EventsGateway,
        useValue: {
          buildCreated: eventsBuildCreatedMock,
          buildFinished: eventsBuildFinishedMock,
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
  };

  it('findMany', async () => {
    const buildFindManyMock = jest.fn().mockResolvedValueOnce([build]);
    const projectId = 'someId';
    mocked(BuildDto).mockReturnValueOnce(buildDto);
    service = await initService({ buildFindManyMock });

    const result = await service.findMany(projectId);

    expect(buildFindManyMock).toHaveBeenCalledWith({
      include: { testRuns: true },
      orderBy: { createdAt: 'desc' },
      where: { projectId },
    });
    expect(result).toEqual([buildDto]);
  });

  describe('create', () => {
    const createBuildDto: CreateBuildDto = {
      ciBuildId: 'ciBuildId',
      branchName: 'branchName',
      project: 'name',
    };

    const project: Project = {
      id: 'project id',
      name: 'name',
      mainBranchName: 'master',
      buildsCounter: 1,
      updatedAt: new Date(),
      createdAt: new Date(),
    };

    it('should create', async () => {
      const buildFindOneMock = jest.fn().mockResolvedValueOnce(null);
      const buildCreateMock = jest.fn().mockResolvedValueOnce(build);
      const projectFindOneMock = jest.fn().mockResolvedValueOnce(project);
      const projectUpdateMock = jest.fn().mockResolvedValueOnce(project);
      const eventsBuildCreatedMock = jest.fn();
      mocked(BuildDto).mockReturnValue(buildDto);
      service = await initService({
        buildCreateMock,
        buildFindOneMock,
        eventsBuildCreatedMock,
        projectFindOneMock,
        projectUpdateMock,
      });

      const result = await service.create(createBuildDto);

      expect(projectFindOneMock).toHaveBeenCalledWith(createBuildDto.project);
      expect(buildFindOneMock).toHaveBeenCalledWith({
        where: {
          ciBuildId: createBuildDto.ciBuildId,
        },
      });
      expect(projectUpdateMock).toHaveBeenCalledWith({
        where: { id: project.id },
        data: {
          buildsCounter: {
            increment: 1,
          },
        },
      });
      expect(buildCreateMock).toHaveBeenCalledWith({
        data: {
          branchName: createBuildDto.branchName,
          ciBuildId: createBuildDto.ciBuildId,
          isRunning: true,
          number: project.buildsCounter,
          project: {
            connect: {
              id: project.id,
            },
          },
        },
      });
      expect(eventsBuildCreatedMock).toHaveBeenCalledWith(buildDto);
      expect(result).toBe(buildDto);
    });

    it('should reuse by ciBuildId', async () => {
      const buildFindOneMock = jest.fn().mockResolvedValueOnce(build);
      const projectFindOneMock = jest.fn().mockResolvedValueOnce(project);
      mocked(BuildDto).mockReturnValue(buildDto);
      service = await initService({
        buildFindOneMock,
        projectFindOneMock,
      });

      const result = await service.create(createBuildDto);

      expect(projectFindOneMock).toHaveBeenCalledWith(createBuildDto.project);
      expect(buildFindOneMock).toHaveBeenCalledWith({
        where: {
          ciBuildId: createBuildDto.ciBuildId,
        },
      });
      expect(result).toBe(buildDto);
    });
  });

  it('delete', async () => {
    const buildFindOneMock = jest.fn().mockResolvedValueOnce(build);
    const buildDeleteMock = jest.fn();
    const testRunDeleteMock = jest.fn();
    service = await initService({ buildFindOneMock, buildDeleteMock, testRunDeleteMock });

    await service.remove(build.id);

    expect(buildFindOneMock).toHaveBeenCalledWith({
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
    const eventsBuildFinishedMock = jest.fn();
    mocked(BuildDto).mockReturnValueOnce(buildDto);
    service = await initService({ buildUpdateMock, eventsBuildFinishedMock });

    const result = await service.stop(id);

    expect(buildUpdateMock).toHaveBeenCalledWith({
      where: { id },
      include: {
        testRuns: true,
      },
      data: {
        isRunning: false,
      },
    });
    expect(eventsBuildFinishedMock).toHaveBeenCalledWith(buildDto);
    expect(result).toBe(buildDto);
  });
});
