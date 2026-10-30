import { Test, TestingModule } from '@nestjs/testing';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';
import { TestVariationsService } from '../test-variations/test-variations.service';
import { BuildsService } from '../builds/builds.service';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ImageComparison } from '@prisma/client';
import { TEST_PROJECT } from '../_data_';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

const initService = async ({
  projectFindUniqueMock = jest.fn(),
  projectFindManyMock = jest.fn(),
  projectCreateMock = jest.fn(),
  projectUpdateMock = jest.fn(),
  projectDeleteMock = jest.fn(),
  userUpdateMock = jest.fn(),
  buildRemoveMock = jest.fn(),
  testVariationDeleteMock = jest.fn(),
}) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ProjectsService,
      {
        provide: PrismaService,
        useValue: {
          project: {
            findUnique: projectFindUniqueMock,
            findMany: projectFindManyMock,
            create: projectCreateMock,
            update: projectUpdateMock,
            delete: projectDeleteMock,
          },
          user: {
            update: userUpdateMock,
          },
        },
      },
      { provide: TestVariationsService, useValue: { delete: testVariationDeleteMock } },
      { provide: BuildsService, useValue: { remove: buildRemoveMock } },
    ],
  }).compile();

  return module.get<ProjectsService>(ProjectsService);
};
describe('ProjectsService', () => {
  let service: ProjectsService;

  describe('findOne', () => {
    it.each([
      ['name', 'someName', { id: undefined, name: 'someName' }],
      ['id', 'a9385fc1-884d-4f9f-915e-40da0e7773d5', { id: 'a9385fc1-884d-4f9f-915e-40da0e7773d5', name: undefined }],
    ])('should find by %s', async (_, query, expected) => {
      const projectFindUniqueMock = jest.fn().mockResolvedValue({});
      service = await initService({ projectFindUniqueMock });

      await service.findOne(query);

      expect(projectFindUniqueMock).toHaveBeenCalledWith({
        where: expected,
      });
    });

    it('should throw exception if not found', async () => {
      const projectFindUniqueMock = jest.fn().mockResolvedValueOnce(undefined);
      service = await initService({ projectFindUniqueMock });

      await expect(service.findOne('foo')).rejects.toThrow(
        new HttpException('Project not found', HttpStatus.NOT_FOUND)
      );
    });
  });
  describe('findAll', () => {
    it('returns every project from the database', async () => {
      const projectFindManyMock = jest.fn().mockResolvedValue([TEST_PROJECT]);
      service = await initService({ projectFindManyMock });

      const result = await service.findAll();

      expect(projectFindManyMock).toHaveBeenCalledWith();
      expect(result).toEqual([TEST_PROJECT]);
    });
  });

  describe('create', () => {
    it('creates the project from the dto fields', async () => {
      const projectCreateMock = jest.fn().mockResolvedValue(TEST_PROJECT);
      service = await initService({ projectCreateMock });
      const dto: CreateProjectDto = {
        name: 'New project',
        mainBranchName: 'main',
        autoApproveFeature: true,
        imageComparison: ImageComparison.lookSame,
        imageComparisonConfig: '{"strict":true}',
        maxBuildAllowed: 50,
        maxBranchLifetime: 10,
        bulkApproveVariations: true,
        bulkApproveGroupBy: 'name',
      };

      const result = await service.create({ ...dto, extra: 'ignored' } as CreateProjectDto);

      expect(projectCreateMock).toHaveBeenCalledWith({ data: dto });
      expect(result).toBe(TEST_PROJECT);
    });
  });

  describe('update', () => {
    it('updates the project by id with the dto fields', async () => {
      const projectUpdateMock = jest.fn().mockResolvedValue(TEST_PROJECT);
      service = await initService({ projectUpdateMock });
      const dto: UpdateProjectDto = {
        id: 'a9385fc1-884d-4f9f-915e-40da0e7773d5',
        name: 'Renamed',
        mainBranchName: 'develop',
        autoApproveFeature: false,
        imageComparison: ImageComparison.pixelmatch,
        imageComparisonConfig: '{}',
        maxBuildAllowed: 5,
        maxBranchLifetime: 7,
        bulkApproveVariations: false,
        bulkApproveGroupBy: 'customTags',
      };

      const result = await service.update(dto);

      const { id, ...data } = dto;
      expect(projectUpdateMock).toHaveBeenCalledWith({ where: { id }, data });
      expect(result).toBe(TEST_PROJECT);
    });
  });

  describe('remove', () => {
    it('returns before builds and variations are removed, then deletes the project in the background', async () => {
      const calls: string[] = [];
      let releaseBuild1!: () => void;
      const build1Gate = new Promise<void>((resolve) => {
        releaseBuild1 = resolve;
      });
      const projectFindUniqueMock = jest.fn().mockResolvedValue({
        ...TEST_PROJECT,
        builds: [{ id: 'build1' }, { id: 'build2' }],
        testVariations: [{ id: 'variation1' }],
      });
      const buildRemoveMock = jest.fn().mockImplementation(async (id) => {
        calls.push(`build ${id}`);
        if (id === 'build1') {
          await build1Gate;
        }
      });
      const testVariationDeleteMock = jest.fn().mockImplementation(async (id) => calls.push(`variation ${id}`));
      const projectDeleteMock = jest.fn().mockImplementation(async () => {
        calls.push('project');
        return TEST_PROJECT;
      });
      service = await initService({
        projectFindUniqueMock,
        buildRemoveMock,
        testVariationDeleteMock,
        projectDeleteMock,
      });

      const result = await service.remove('projectId');

      expect(result).toEqual(expect.objectContaining({ id: TEST_PROJECT.id }));
      expect(projectDeleteMock).not.toHaveBeenCalled();

      releaseBuild1();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(projectFindUniqueMock).toHaveBeenCalledWith({
        where: { id: 'projectId' },
        include: { builds: true, testVariations: true },
      });
      expect(calls).toEqual(['build build1', 'build build2', 'variation variation1', 'project']);
      expect(projectDeleteMock).toHaveBeenCalledWith({ where: { id: 'projectId' } });
    });

    it('logs a failing background cleanup without rejecting the caller', async () => {
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);
      try {
        const projectFindUniqueMock = jest.fn().mockResolvedValue({
          ...TEST_PROJECT,
          builds: [{ id: 'build1' }, { id: 'build2' }],
          testVariations: [{ id: 'variation1' }],
        });
        const buildRemoveMock = jest.fn().mockRejectedValueOnce(new Error('cannot delete'));
        const testVariationDeleteMock = jest.fn();
        const projectDeleteMock = jest.fn();
        service = await initService({
          projectFindUniqueMock,
          buildRemoveMock,
          testVariationDeleteMock,
          projectDeleteMock,
        });

        await expect(service.remove('projectId')).resolves.toEqual(expect.objectContaining({ id: TEST_PROJECT.id }));
        await new Promise((resolve) => setImmediate(resolve));

        expect(buildRemoveMock).toHaveBeenCalledTimes(1);
        expect(testVariationDeleteMock).not.toHaveBeenCalled();
        expect(projectDeleteMock).not.toHaveBeenCalled();
        expect(unhandled).not.toHaveBeenCalled();
        expect(service['ongoingDeletions'].has('projectId')).toBe(false);
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });

    it('should handle concurrent calls for the same project by returning without starting a second cleanup', async () => {
      let releaseBuild1!: () => void;
      const build1Gate = new Promise<void>((resolve) => {
        releaseBuild1 = resolve;
      });
      const projectFindUniqueMock = jest
        .fn()
        .mockResolvedValueOnce({
          ...TEST_PROJECT,
          builds: [{ id: 'build1' }],
          testVariations: [],
        })
        .mockResolvedValueOnce(TEST_PROJECT);
      const buildRemoveMock = jest.fn().mockImplementation(async () => {
        await build1Gate;
      });
      const projectDeleteMock = jest.fn().mockResolvedValue(TEST_PROJECT);
      service = await initService({
        projectFindUniqueMock,
        buildRemoveMock,
        projectDeleteMock,
      });

      const promise1 = service.remove('projectId');
      await new Promise((resolve) => setImmediate(resolve));
      const promise2 = service.remove('projectId');

      await expect(promise2).resolves.toEqual(expect.objectContaining({ id: TEST_PROJECT.id }));
      expect(buildRemoveMock).toHaveBeenCalledTimes(1);

      releaseBuild1();
      await promise1;
      await new Promise((resolve) => setImmediate(resolve));

      expect(service['ongoingDeletions'].has('projectId')).toBe(false);
    });

    it('throws a TypeError when the project does not exist', async () => {
      const projectFindUniqueMock = jest.fn().mockResolvedValue(null);
      const projectDeleteMock = jest.fn();
      service = await initService({ projectFindUniqueMock, projectDeleteMock });

      // NOTE: current behavior — no not-found handling (unlike findOne), the null project is dereferenced
      await expect(service.remove('missing')).rejects.toThrow(TypeError);
      expect(projectDeleteMock).not.toHaveBeenCalled();
    });
  });

  describe('favourites', () => {
    const userId = 'b1e2c3d4-0000-4000-8000-000000000001';
    const projectId = 'a9385fc1-884d-4f9f-915e-40da0e7773d5';

    it('lists the ids of the projects the user marked as favourite', async () => {
      const projectFindManyMock = jest.fn().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
      service = await initService({ projectFindManyMock });

      const result = await service.findFavoriteIds(userId);

      expect(projectFindManyMock).toHaveBeenCalledWith({
        where: { favoritedBy: { some: { id: userId } } },
        select: { id: true },
      });
      expect(result).toEqual(['p1', 'p2']);
    });

    it('lists nothing for a user without favourites', async () => {
      const projectFindManyMock = jest.fn().mockResolvedValue([]);
      service = await initService({ projectFindManyMock });

      await expect(service.findFavoriteIds(userId)).resolves.toEqual([]);
    });

    it('connects the project to the user favourites', async () => {
      const projectFindUniqueMock = jest.fn().mockResolvedValue(TEST_PROJECT);
      const userUpdateMock = jest.fn().mockResolvedValue({});
      service = await initService({ projectFindUniqueMock, userUpdateMock });

      await service.addFavorite(userId, projectId);

      expect(projectFindUniqueMock).toHaveBeenCalledWith({ where: { id: projectId, name: undefined } });
      expect(userUpdateMock).toHaveBeenCalledWith({
        where: { id: userId },
        data: { favoriteProjects: { connect: { id: projectId } } },
        select: { id: true },
      });
    });

    it('adds a favourite twice without an error', async () => {
      const projectFindUniqueMock = jest.fn().mockResolvedValue(TEST_PROJECT);
      const userUpdateMock = jest.fn().mockResolvedValue({});
      service = await initService({ projectFindUniqueMock, userUpdateMock });

      await service.addFavorite(userId, projectId);
      await expect(service.addFavorite(userId, projectId)).resolves.toBeUndefined();

      expect(userUpdateMock).toHaveBeenCalledTimes(2);
    });

    it('answers 404 and changes nothing when the project does not exist', async () => {
      const projectFindUniqueMock = jest.fn().mockResolvedValue(null);
      const userUpdateMock = jest.fn();
      service = await initService({ projectFindUniqueMock, userUpdateMock });

      await expect(service.addFavorite(userId, projectId)).rejects.toThrow(
        new HttpException('Project not found', HttpStatus.NOT_FOUND)
      );
      expect(userUpdateMock).not.toHaveBeenCalled();
    });

    it('disconnects the project from the user favourites', async () => {
      const userUpdateMock = jest.fn().mockResolvedValue({});
      service = await initService({ userUpdateMock });

      await expect(service.removeFavorite(userId, projectId)).resolves.toBeUndefined();

      expect(userUpdateMock).toHaveBeenCalledWith({
        where: { id: userId },
        data: { favoriteProjects: { disconnect: { id: projectId } } },
        select: { id: true },
      });
    });

    it('removes a project that is not a favourite without an error', async () => {
      // Prisma treats disconnecting an unconnected record as a no-op, so the
      // service does no lookup of its own first
      const projectFindUniqueMock = jest.fn();
      const userUpdateMock = jest.fn().mockResolvedValue({});
      service = await initService({ projectFindUniqueMock, userUpdateMock });

      await expect(service.removeFavorite(userId, projectId)).resolves.toBeUndefined();
      expect(projectFindUniqueMock).not.toHaveBeenCalled();
    });
  });
});
