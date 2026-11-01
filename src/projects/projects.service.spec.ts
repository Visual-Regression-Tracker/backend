import { Test } from '@nestjs/testing';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';
import { StaticService } from '../static/static.service';
import { EventsGateway } from '../shared/events/events.gateway';
import { BuildDto } from '../builds/dto/build.dto';
import { BadRequestException, ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { ImageComparison, Prisma } from '@prisma/client';
import { TEST_PROJECT } from '../_data_';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

const projectId = 'a9385fc1-884d-4f9f-915e-40da0e7773d5';
const notFound = new HttpException('Project not found', HttpStatus.NOT_FOUND);

const setup = async () => {
  const prisma = {
    project: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: { update: jest.fn() },
    $transaction: jest.fn(),
  };
  const deleteImage = jest.fn();
  const buildDeleted = jest.fn();
  const module = await Test.createTestingModule({
    providers: [
      ProjectsService,
      { provide: PrismaService, useValue: prisma },
      {
        provide: StaticService,
        useValue: {
          deleteImages: async (names: Iterable<string | null | undefined>) => {
            for (const name of names) if (name) await deleteImage(name);
          },
        },
      },
      { provide: EventsGateway, useValue: { buildDeleted } },
    ],
  }).compile();

  return { service: module.get(ProjectsService), prisma, deleteImage, buildDeleted };
};

describe('ProjectsService', () => {
  describe('findOne', () => {
    it.each([
      ['name', 'someName', { id: undefined, name: 'someName' }],
      ['id', projectId, { id: projectId, name: undefined }],
    ])('should find by %s', async (_, query, expected) => {
      const { service, prisma } = await setup();
      prisma.project.findUnique.mockResolvedValue({});

      await service.findOne(query);

      expect(prisma.project.findUnique).toHaveBeenCalledWith({ where: expected });
    });

    it('should throw exception if not found', async () => {
      const { service, prisma } = await setup();
      prisma.project.findUnique.mockResolvedValueOnce(undefined);

      await expect(service.findOne('foo')).rejects.toThrow(notFound);
    });
  });

  it('findAll returns every project from the database', async () => {
    const { service, prisma } = await setup();
    prisma.project.findMany.mockResolvedValue([TEST_PROJECT]);

    const result = await service.findAll();

    expect(prisma.project.findMany).toHaveBeenCalledWith();
    expect(result).toEqual([TEST_PROJECT]);
  });

  it('create creates the project from the dto fields', async () => {
    const { service, prisma } = await setup();
    prisma.project.create.mockResolvedValue(TEST_PROJECT);
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

    expect(prisma.project.create).toHaveBeenCalledWith({ data: dto });
    expect(result).toBe(TEST_PROJECT);
  });

  it('update updates the project by id with the dto fields', async () => {
    const { service, prisma } = await setup();
    prisma.project.update.mockResolvedValue(TEST_PROJECT);
    const dto: UpdateProjectDto = {
      id: projectId,
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
    expect(prisma.project.update).toHaveBeenCalledWith({ where: { id }, data });
    expect(result).toBe(TEST_PROJECT);
  });

  it('update keeps the stored Gemini key when the masked key comes back', async () => {
    const { service, prisma } = await setup();
    const key = 'AIzaSy-stored-gemini-key-1234';
    prisma.project.findUnique.mockResolvedValue({ imageComparisonConfig: JSON.stringify({ apiKey: key }) });
    prisma.project.update.mockResolvedValue(TEST_PROJECT);

    await service.update({
      ...TEST_PROJECT,
      imageComparison: ImageComparison.vlm,
      imageComparisonConfig: JSON.stringify({ apiKey: '••••1234', model: 'gemini-2.5-flash' }),
    });

    expect(prisma.project.findUnique).toHaveBeenCalledWith({
      where: { id: TEST_PROJECT.id },
      select: { imageComparisonConfig: true },
    });
    const { data } = prisma.project.update.mock.calls[0][0];
    expect(JSON.parse(data.imageComparisonConfig)).toEqual({ apiKey: key, model: 'gemini-2.5-flash' });
  });

  describe('odiff on S3 storage', () => {
    const originalStaticService = process.env.STATIC_SERVICE;
    const odiffDto = { ...TEST_PROJECT, id: projectId, imageComparison: ImageComparison.odiff } as UpdateProjectDto;

    afterEach(() => {
      if (originalStaticService === undefined) {
        delete process.env.STATIC_SERVICE;
      } else {
        process.env.STATIC_SERVICE = originalStaticService;
      }
    });

    it.each(['create', 'update'] as const)(
      '%s rejects odiff on S3 storage with 400 and writes nothing',
      async (method) => {
        process.env.STATIC_SERVICE = 's3';
        const { service, prisma } = await setup();

        await expect(service[method](odiffDto)).rejects.toThrow(BadRequestException);

        expect(prisma.project.create).not.toHaveBeenCalled();
        expect(prisma.project.update).not.toHaveBeenCalled();
      }
    );

    it.each(['create', 'update'] as const)('%s accepts odiff on HDD storage', async (method) => {
      delete process.env.STATIC_SERVICE;
      const { service, prisma } = await setup();
      prisma.project.create.mockResolvedValue(TEST_PROJECT);
      prisma.project.update.mockResolvedValue(TEST_PROJECT);

      await expect(service[method](odiffDto)).resolves.toBe(TEST_PROJECT);
    });

    it('still accepts other comparators on S3 storage', async () => {
      process.env.STATIC_SERVICE = 's3';
      const { service, prisma } = await setup();
      prisma.project.create.mockResolvedValue(TEST_PROJECT);

      await expect(service.create({ ...odiffDto, imageComparison: ImageComparison.lookSame })).resolves.toBe(
        TEST_PROJECT
      );
    });
  });

  describe('remove', () => {
    const knownRequestError = (code: string) =>
      new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: 'test' });

    const initRemove = async (transaction?: (fn: (tx: unknown) => unknown) => unknown) => {
      const ctx = await setup();
      const calls: string[] = [];
      const record = <T>(name: string, result?: T) =>
        jest.fn().mockImplementation(async () => {
          calls.push(name);
          return result;
        });
      const builds = ['build1', 'build2'].map((id) => ({
        id,
        ciBuildId: null,
        number: 1,
        branchName: 'master',
        status: null,
        projectId,
        updatedAt: new Date(),
        createdAt: new Date(),
        userId: null,
        isRunning: false,
      }));
      const tx = {
        build: { findMany: record('build.findMany', builds), deleteMany: record('build.deleteMany') },
        testRun: {
          findMany: record('testRun.findMany', [
            { imageName: 'run1.png', diffName: 'run1.diff.png', imageThumbnailName: null, diffThumbnailName: null },
            { imageName: 'run2.png', diffName: null, imageThumbnailName: 'run2.thumb.png', diffThumbnailName: '' },
          ]),
          deleteMany: record('testRun.deleteMany'),
        },
        baseline: {
          findMany: record('baseline.findMany', [{ baselineName: 'baseline1.png' }]),
          deleteMany: record('baseline.deleteMany'),
        },
        testVariation: { deleteMany: record('testVariation.deleteMany') },
        project: { delete: record('project.delete', TEST_PROJECT) },
      };
      ctx.prisma.project.findUnique.mockResolvedValue(TEST_PROJECT);
      ctx.prisma.$transaction.mockImplementation(transaction ?? ((fn, _options) => fn(tx)));
      ctx.deleteImage.mockImplementation(async (name) => calls.push(`deleteImage ${name}`));
      ctx.buildDeleted.mockImplementation((dto) => calls.push(`buildDeleted ${dto.id}`));
      return { ...ctx, calls, tx, builds, transaction: ctx.prisma.$transaction };
    };

    it('removes rows in FK order inside one transaction, then files, then announces builds', async () => {
      const { service, calls, tx, transaction } = await initRemove();

      const result = await service.remove(projectId);

      expect(calls).toEqual([
        'build.findMany',
        'testRun.findMany',
        'baseline.findMany',
        'testRun.deleteMany',
        'baseline.deleteMany',
        'testVariation.deleteMany',
        'build.deleteMany',
        'project.delete',
        'deleteImage run1.png',
        'deleteImage run1.diff.png',
        'deleteImage run2.png',
        'deleteImage run2.thumb.png',
        'deleteImage baseline1.png',
        'buildDeleted build1',
        'buildDeleted build2',
      ]);
      expect(tx.testRun.deleteMany).toHaveBeenCalledWith({ where: { build: { projectId } } });
      expect(tx.baseline.deleteMany).toHaveBeenCalledWith({ where: { testVariation: { projectId } } });
      expect(tx.project.delete).toHaveBeenCalledWith({ where: { id: projectId } });
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 10000, timeout: 120000 });
      expect(result).toBe(TEST_PROJECT);
    });

    it('announces every build with the build dto', async () => {
      const { service, buildDeleted, builds } = await initRemove();

      await service.remove(projectId);

      expect(buildDeleted).toHaveBeenNthCalledWith(1, new BuildDto(builds[0]));
      expect(buildDeleted).toHaveBeenNthCalledWith(2, new BuildDto(builds[1]));
    });

    it('deletes no file when the transaction fails', async () => {
      const { service, tx, deleteImage, buildDeleted } = await initRemove();
      tx.project.delete.mockRejectedValue(new Error('db down'));

      await expect(service.remove(projectId)).rejects.toThrow('db down');

      expect(deleteImage).not.toHaveBeenCalled();
      expect(buildDeleted).not.toHaveBeenCalled();
    });

    it('retries when an upload added rows meanwhile (P2003)', async () => {
      let attempt = 0;
      const { service, transaction, tx } = await initRemove((fn) => {
        if (++attempt === 1) {
          throw knownRequestError('P2003');
        }
        return fn(tx);
      });

      await expect(service.remove(projectId)).resolves.toBe(TEST_PROJECT);

      expect(transaction).toHaveBeenCalledTimes(2);
    });

    it('answers 409 when uploads keep arriving', async () => {
      const { service, transaction, deleteImage } = await initRemove(() => {
        throw knownRequestError('P2003');
      });

      await expect(service.remove(projectId)).rejects.toThrow(ConflictException);

      expect(transaction).toHaveBeenCalledTimes(3);
      expect(deleteImage).not.toHaveBeenCalled();
    });

    it('answers 404 when the project disappears meanwhile (P2025)', async () => {
      const { service, transaction } = await initRemove(() => {
        throw knownRequestError('P2025');
      });

      await expect(service.remove(projectId)).rejects.toThrow(notFound);

      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('answers 404 for an unknown project and deletes nothing', async () => {
      const { service, prisma } = await setup();
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toThrow(notFound);
      expect(prisma.project.delete).not.toHaveBeenCalled();
    });
  });

  describe('favourites', () => {
    const userId = 'b1e2c3d4-0000-4000-8000-000000000001';

    it.each([
      [
        [{ id: 'p1' }, { id: 'p2' }],
        ['p1', 'p2'],
      ],
      [[], []],
    ])('lists the ids of the projects the user marked as favourite (%j)', async (rows, ids) => {
      const { service, prisma } = await setup();
      prisma.project.findMany.mockResolvedValue(rows);

      const result = await service.findFavoriteIds(userId);

      expect(prisma.project.findMany).toHaveBeenCalledWith({
        where: { favoritedBy: { some: { id: userId } } },
        select: { id: true },
      });
      expect(result).toEqual(ids);
    });

    it('connects the project to the user favourites', async () => {
      const { service, prisma } = await setup();
      prisma.project.findUnique.mockResolvedValue(TEST_PROJECT);

      await service.addFavorite(userId, projectId);

      expect(prisma.project.findUnique).toHaveBeenCalledWith({ where: { id: projectId, name: undefined } });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { favoriteProjects: { connect: { id: projectId } } },
        select: { id: true },
      });
    });

    it('adds a favourite twice without an error', async () => {
      const { service, prisma } = await setup();
      prisma.project.findUnique.mockResolvedValue(TEST_PROJECT);

      await service.addFavorite(userId, projectId);
      await expect(service.addFavorite(userId, projectId)).resolves.toBeUndefined();

      expect(prisma.user.update).toHaveBeenCalledTimes(2);
    });

    it('answers 404 and changes nothing when the project does not exist', async () => {
      const { service, prisma } = await setup();
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.addFavorite(userId, projectId)).rejects.toThrow(notFound);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('disconnects the project from the user favourites without looking it up', async () => {
      const { service, prisma } = await setup();

      await expect(service.removeFavorite(userId, projectId)).resolves.toBeUndefined();

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { favoriteProjects: { disconnect: { id: projectId } } },
        select: { id: true },
      });
      expect(prisma.project.findUnique).not.toHaveBeenCalled();
    });
  });
});
