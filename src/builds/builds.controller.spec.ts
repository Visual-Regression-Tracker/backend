import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BuildsController } from './builds.controller';
import { BuildsService } from './builds.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApiGuard } from '../auth/guards/api.guard';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { ProjectsService } from '../projects/projects.service';
import { TEST_BUILD, TEST_PROJECT } from '../_data_';
import { User } from '@prisma/client';
import { BuildDto } from './dto/build.dto';
import { ModifyBuildDto } from './dto/build-modify.dto';

describe('Builds Controller', () => {
  let controller: BuildsController;
  const buildsService = {
    findMany: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
    update: jest.fn(),
    approve: jest.fn(),
    scheduleRetention: jest.fn(),
    findOrCreate: jest.fn(),
  };
  const projectsService = { findOne: jest.fn() };
  const buildDto = new BuildDto(TEST_BUILD);
  const retentionArgs = [TEST_PROJECT.id, TEST_PROJECT.maxBuildAllowed, TEST_BUILD.id];

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      controllers: [BuildsController],
      providers: [
        { provide: BuildsService, useValue: buildsService },
        { provide: ProjectsService, useValue: projectsService },
        { provide: PrismaService, useValue: {} },
        { provide: ApiGuard, useValue: {} },
        { provide: JwtAuthGuard, useValue: {} },
      ],
    }).compile();

    controller = module.get(BuildsController);
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

  it.each([
    [10, -1],
    [-1, 0],
  ])('answers 400 for take=%p skip=%p without querying', async (take, skip) => {
    await expect(controller.get('projectId', take, skip)).rejects.toThrow(BadRequestException);

    expect(buildsService.findMany).not.toHaveBeenCalled();
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

  describe('update', () => {
    it.each([
      ['no body', undefined],
      ['null body', null],
      ['empty body', {}],
    ])('should stop build when called with %s', async (_, body) => {
      buildsService.update.mockResolvedValue(buildDto);

      await expect(controller.update(TEST_BUILD.id, body as ModifyBuildDto)).resolves.toBe(buildDto);

      expect(buildsService.update).toHaveBeenCalledWith(TEST_BUILD.id, { isRunning: false });
    });

    it.each([[{ isRunning: false }], [{ isRunning: true }], [{ ciBuildId: 'ciBuildId' }]])(
      'should pass %o as is',
      async (body) => {
        buildsService.update.mockResolvedValue(buildDto);

        await expect(controller.update(TEST_BUILD.id, body)).resolves.toBe(buildDto);

        expect(buildsService.update).toHaveBeenCalledWith(TEST_BUILD.id, body);
      }
    );
  });

  it.each([true, false])('approves a build with merge=%s', async (merge) => {
    buildsService.approve.mockResolvedValue(undefined);

    await expect(controller.approve({ id: 'user id' } as User, TEST_BUILD.id, merge)).resolves.toBeUndefined();
    expect(buildsService.approve).toHaveBeenCalledWith(TEST_BUILD.id, merge, 'user id');
  });

  it("creates the build on the project's main branch when no branch is given", async () => {
    projectsService.findOne.mockResolvedValue(TEST_PROJECT);
    buildsService.findOrCreate.mockResolvedValue({ ...TEST_BUILD, number: 12 });

    const result = await controller.create({ project: TEST_PROJECT.name, ciBuildId: 'ci-1' });

    expect(projectsService.findOne).toHaveBeenCalledWith(TEST_PROJECT.name);
    expect(buildsService.scheduleRetention).toHaveBeenCalledWith(...retentionArgs);
    expect(buildsService.findOrCreate).toHaveBeenCalledWith({
      projectId: TEST_PROJECT.id,
      branchName: TEST_PROJECT.mainBranchName,
      ciBuildId: 'ci-1',
    });
    expect(result).toStrictEqual(new BuildDto({ ...TEST_BUILD, number: 12 }));
  });

  it('schedules retention after creating the build, sparing it', async () => {
    const calls: string[] = [];
    projectsService.findOne.mockResolvedValue(TEST_PROJECT);
    buildsService.scheduleRetention.mockImplementation(() => calls.push('scheduleRetention'));
    buildsService.findOrCreate.mockImplementation(async () => {
      calls.push('findOrCreate');
      return TEST_BUILD;
    });

    await controller.create({ project: TEST_PROJECT.id, branchName: 'feature' });

    expect(calls).toEqual(['findOrCreate', 'scheduleRetention']);
    expect(buildsService.scheduleRetention).toHaveBeenCalledWith(...retentionArgs);
    expect(buildsService.findOrCreate).toHaveBeenCalledWith({
      projectId: TEST_PROJECT.id,
      branchName: 'feature',
      ciBuildId: undefined,
    });
  });
});
