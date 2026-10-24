import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BuildsController } from './builds.controller';
import { BuildsService } from './builds.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApiGuard } from '../auth/guards/api.guard';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { ProjectsService } from '../projects/projects.service';
import { TEST_BUILD, TEST_PROJECT } from '../_data_';
import { Build } from '@prisma/client';
import { BuildDto } from './dto/build.dto';
import { CreateBuildDto } from './dto/build-create.dto';
import { ModifyBuildDto } from './dto/build-modify.dto';
import { EventsGateway } from '../shared/events/events.gateway';

const initController = async ({
  projectFindOneMock = jest.fn(),
  buildFindOrCreateMock = jest.fn(),
  buildIncrementBuildNumberMock = jest.fn(),
  eventBuildCreatedMock = jest.fn(),
  deleteOldBuilds = jest.fn(),
  buildUpdateMock = jest.fn(),
}) => {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [BuildsController],
    providers: [
      {
        provide: ProjectsService,
        useValue: {
          findOne: projectFindOneMock,
        },
      },
      {
        provide: BuildsService,
        useValue: {
          findOrCreate: buildFindOrCreateMock,
          incrementBuildNumber: buildIncrementBuildNumberMock,
          deleteOldBuilds: deleteOldBuilds,
          update: buildUpdateMock,
        },
      },
      { provide: EventsGateway, useValue: { buildCreated: eventBuildCreatedMock } },
      { provide: PrismaService, useValue: {} },
      { provide: ApiGuard, useValue: {} },
      { provide: JwtAuthGuard, useValue: {} },
    ],
  }).compile();

  return module.get<BuildsController>(BuildsController);
};
describe('Builds Controller', () => {
  let controller: BuildsController;

  const createBuildDto: CreateBuildDto = {
    ciBuildId: 'ciBuildId',
    branchName: 'branchName',
    project: 'name',
  };
  const project = TEST_PROJECT;
  const buildWithNumber: Build = {
    ...TEST_BUILD,
    number: 12,
  };

  beforeEach(async () => {});

  it('should be defined', async () => {
    controller = await initController({});
    expect(controller).toBeDefined();
  });

  it('should create new build', async () => {
    const projectFindOneMock = jest.fn().mockResolvedValueOnce(project);
    const buildFindOrCreateMock = jest.fn().mockResolvedValueOnce(buildWithNumber);
    const deleteOldBuilds = jest.fn();
    controller = await initController({
      projectFindOneMock,
      buildFindOrCreateMock,
      deleteOldBuilds,
    });

    const result = await controller.create(createBuildDto);

    expect(result).toStrictEqual(new BuildDto(buildWithNumber));
    expect(deleteOldBuilds).toHaveBeenCalledWith(project.id, project.maxBuildAllowed, createBuildDto.ciBuildId);
  });

  it('should reuse build', async () => {
    const eventBuildCreatedMock = jest.fn();
    const projectFindOneMock = jest.fn().mockResolvedValueOnce(project);
    const buildFindOrCreateMock = jest.fn().mockResolvedValueOnce(buildWithNumber);
    const deleteOldBuilds = jest.fn();
    controller = await initController({
      projectFindOneMock,
      buildFindOrCreateMock,
      eventBuildCreatedMock,
      deleteOldBuilds,
    });

    const result = await controller.create(createBuildDto);

    expect(result).toStrictEqual(new BuildDto(buildWithNumber));
  });

  describe('update', () => {
    it.each([
      ['no body', undefined],
      ['null body', null],
      ['empty body', {}],
    ])('should stop build when called with %s', async (_, body) => {
      const buildUpdateMock = jest.fn().mockResolvedValueOnce(new BuildDto(TEST_BUILD));
      controller = await initController({ buildUpdateMock });

      await controller.update(TEST_BUILD.id, body as ModifyBuildDto);

      expect(buildUpdateMock).toHaveBeenCalledWith(TEST_BUILD.id, { isRunning: false });
    });

    it.each([[{ isRunning: false }], [{ isRunning: true }], [{ ciBuildId: 'ciBuildId' }]])(
      'should pass %o as is',
      async (body) => {
        const buildUpdateMock = jest.fn().mockResolvedValueOnce(new BuildDto(TEST_BUILD));
        controller = await initController({ buildUpdateMock });

        await controller.update(TEST_BUILD.id, body);

        expect(buildUpdateMock).toHaveBeenCalledWith(TEST_BUILD.id, body);
      }
    );
  });
});

describe('Builds Controller handlers', () => {
  let controller: BuildsController;
  const buildsService = {
    findMany: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
    update: jest.fn(),
    approve: jest.fn(),
    deleteOldBuilds: jest.fn(),
    findOrCreate: jest.fn(),
  };
  const projectsService = { findOne: jest.fn() };
  const buildDto = new BuildDto(TEST_BUILD);

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BuildsController],
      providers: [
        { provide: BuildsService, useValue: buildsService },
        { provide: ProjectsService, useValue: projectsService },
        { provide: PrismaService, useValue: {} },
        { provide: ApiGuard, useValue: {} },
        { provide: JwtAuthGuard, useValue: {} },
      ],
    }).compile();

    controller = module.get<BuildsController>(BuildsController);
  });

  it('lists a page of builds with the filters it was given', async () => {
    const page = { data: [buildDto], total: 1, take: 10, skip: 0 };
    buildsService.findMany.mockResolvedValue(page);

    const result = await controller.get('projectId', 10, 20, 'ci-1', 'aroundId');

    expect(result).toBe(page);
    expect(buildsService.findMany).toHaveBeenCalledWith('projectId', 10, 20, 'ci-1', 'aroundId');
  });

  it('passes missing optional filters on as undefined', async () => {
    buildsService.findMany.mockResolvedValue({ data: [], total: 0, take: 10, skip: 0 });

    await controller.get('projectId', 10, 0);

    expect(buildsService.findMany).toHaveBeenCalledWith('projectId', 10, 0, undefined, undefined);
  });

  it('returns the details of one build', async () => {
    buildsService.findOne.mockResolvedValue(buildDto);

    await expect(controller.getDetails(TEST_BUILD.id)).resolves.toBe(buildDto);
    expect(buildsService.findOne).toHaveBeenCalledWith(TEST_BUILD.id);
  });

  it('removes a build', async () => {
    buildsService.remove.mockResolvedValue(TEST_BUILD);

    await expect(controller.remove(TEST_BUILD.id)).resolves.toBe(TEST_BUILD);
    expect(buildsService.remove).toHaveBeenCalledWith(TEST_BUILD.id);
  });

  it('throws NotFoundException when there is no build to remove', async () => {
    buildsService.remove.mockResolvedValue(undefined);

    await expect(controller.remove('missing')).rejects.toThrow(new NotFoundException('Build not found: missing'));
  });

  it('updates a build with the body', async () => {
    buildsService.update.mockResolvedValue(buildDto);

    await expect(controller.update(TEST_BUILD.id, { isRunning: false })).resolves.toBe(buildDto);
    expect(buildsService.update).toHaveBeenCalledWith(TEST_BUILD.id, { isRunning: false });
  });

  it.each([true, false])('approves a build with merge=%s', async (merge) => {
    buildsService.approve.mockResolvedValue(undefined);

    await expect(controller.approve(TEST_BUILD.id, merge)).resolves.toBeUndefined();
    expect(buildsService.approve).toHaveBeenCalledWith(TEST_BUILD.id, merge);
  });

  it("creates the build on the project's main branch when no branch is given", async () => {
    projectsService.findOne.mockResolvedValue(TEST_PROJECT);
    buildsService.findOrCreate.mockResolvedValue(TEST_BUILD);

    const result = await controller.create({ project: TEST_PROJECT.name, ciBuildId: 'ci-1' } as CreateBuildDto);

    expect(projectsService.findOne).toHaveBeenCalledWith(TEST_PROJECT.name);
    expect(buildsService.deleteOldBuilds).toHaveBeenCalledWith(TEST_PROJECT.id, TEST_PROJECT.maxBuildAllowed, 'ci-1');
    expect(buildsService.findOrCreate).toHaveBeenCalledWith({
      projectId: TEST_PROJECT.id,
      branchName: TEST_PROJECT.mainBranchName,
      ciBuildId: 'ci-1',
    });
    expect(result).toStrictEqual(new BuildDto(TEST_BUILD));
  });

  it('deletes old builds before creating the new one', async () => {
    const calls: string[] = [];
    projectsService.findOne.mockResolvedValue(TEST_PROJECT);
    buildsService.deleteOldBuilds.mockImplementation(async () => calls.push('deleteOldBuilds'));
    buildsService.findOrCreate.mockImplementation(async () => {
      calls.push('findOrCreate');
      return TEST_BUILD;
    });

    await controller.create({ project: TEST_PROJECT.id, branchName: 'feature' } as CreateBuildDto);

    expect(calls).toEqual(['deleteOldBuilds', 'findOrCreate']);
    expect(buildsService.findOrCreate).toHaveBeenCalledWith({
      projectId: TEST_PROJECT.id,
      branchName: 'feature',
      ciBuildId: undefined,
    });
  });
});
