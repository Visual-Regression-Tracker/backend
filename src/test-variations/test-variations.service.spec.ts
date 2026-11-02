import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TestVariationsService } from './test-variations.service';
import { PrismaService } from '../prisma/prisma.service';
import { StaticService } from '../static/static.service';
import { Prisma } from '@prisma/client';
import { PNG } from 'pngjs';
import { BuildsService } from '../builds/builds.service';
import { TestRunsService } from '../test-runs/test-runs.service';
import { generateTestVariation, TEST_PROJECT } from '../_data_';

const build = async () => {
  const m = {
    static: { getImageBuffer: jest.fn(), deleteImage: jest.fn() },
    builds: { findOrCreate: jest.fn(), update: jest.fn() },
    testRuns: { create: jest.fn(), calculateDiff: jest.fn() },
    prisma: {
      $executeRaw: jest.fn(),
      $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
      testVariation: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockReturnValue([]),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      baseline: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
      project: { findUnique: jest.fn() },
    },
  };
  const module = await Test.createTestingModule({
    providers: [
      TestVariationsService,
      {
        provide: StaticService,
        useValue: {
          ...m.static,
          deleteImages: async (names: Iterable<string | null | undefined>) => {
            for (const name of names) if (name) await m.static.deleteImage(name);
          },
        },
      },
      { provide: BuildsService, useValue: m.builds },
      { provide: TestRunsService, useValue: m.testRuns },
      { provide: PrismaService, useValue: m.prisma },
    ],
  }).compile();
  return { service: module.get<TestVariationsService>(TestVariationsService), m };
};

const baselineData = {
  name: 'Test name',
  os: 'OS',
  browser: 'browser',
  viewport: 'viewport',
  device: 'device',
  customTags: 'tag',
};
const findRequest = (overrides: object = {}) => ({
  ...baselineData,
  projectId: TEST_PROJECT.id,
  branchName: 'develop',
  ...overrides,
});
const keyOf = (variation: typeof baselineData & { projectId: string }, branchName: string) => ({
  name: variation.name,
  os: variation.os,
  device: variation.device,
  browser: variation.browser,
  viewport: variation.viewport,
  customTags: variation.customTags,
  branchName,
  projectId: variation.projectId,
});
const prismaError = (code: string) => new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: 'test' });

describe('TestVariationsService', () => {
  describe('getDetails', () => {
    it('can find one', async () => {
      const { service, m } = await build();
      m.prisma.testVariation.findUnique.mockResolvedValueOnce(generateTestVariation({ id: 'test id' }, []));

      await service.getDetails('test id');

      expect(m.prisma.testVariation.findUnique).toHaveBeenCalledWith({
        where: { id: 'test id' },
        include: {
          baselines: {
            include: {
              testRun: true,
              user: { omit: { password: true, apiKey: true } },
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
      });
    });

    it('throws NotFoundException for an unknown id', async () => {
      const { service, m } = await build();
      m.prisma.testVariation.findUnique.mockResolvedValueOnce(null);

      await expect(service.getDetails('missing')).rejects.toThrow(
        new NotFoundException('Test variation not found: missing')
      );
    });
  });

  describe('findBaselineHistory', () => {
    it('lists id and name of every baseline, newest first', async () => {
      const history = [
        { id: 'b3', baselineName: 'c.png' },
        { id: 'b2', baselineName: 'b.png' },
      ];
      const { service, m } = await build();
      m.prisma.baseline.findMany.mockResolvedValueOnce(history);

      const result = await service.findBaselineHistory('variationId');

      expect(m.prisma.baseline.findMany).toHaveBeenCalledWith({
        where: { testVariationId: 'variationId' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, baselineName: true },
      });
      expect(result).toBe(history);
    });
  });

  describe('findLatestBaselines', () => {
    const row = (id: string) => ({ id, baselineName: `${id}.png`, testVariationId: id.split('-')[0] });

    it('takes the newest baseline of each variation in the given order', async () => {
      const { service, m } = await build();
      m.prisma.baseline.findMany.mockResolvedValueOnce(['v2-new', 'v1-new', 'v2-old', 'v1-old'].map(row));

      const result = await service.findLatestBaselines(['v1', 'v2']);

      expect(m.prisma.baseline.findMany).toHaveBeenCalledWith({
        where: { testVariationId: { in: ['v1', 'v2'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, baselineName: true, testVariationId: true },
      });
      expect(result).toStrictEqual([
        { id: 'v1-new', baselineName: 'v1-new.png' },
        { id: 'v2-new', baselineName: 'v2-new.png' },
      ]);
    });

    it('leaves out variations without baselines', async () => {
      const { service, m } = await build();
      m.prisma.baseline.findMany.mockResolvedValueOnce([row('v2-new')]);

      expect(await service.findLatestBaselines(['v1', 'v2'])).toStrictEqual([
        { id: 'v2-new', baselineName: 'v2-new.png' },
      ]);
    });

    it('does not query for no ids', async () => {
      const { service, m } = await build();

      expect(await service.findLatestBaselines([])).toStrictEqual([]);
      expect(m.prisma.baseline.findMany).not.toHaveBeenCalled();
    });
  });

  describe('find', () => {
    const initFind = async (...found: unknown[]) => {
      const ctx = await build();
      ctx.service.findUnique = jest.fn();
      found.forEach((variation) => jest.mocked(ctx.service.findUnique).mockResolvedValueOnce(variation as never));
      return ctx;
    };
    const main = generateTestVariation({ branchName: 'master', updatedAt: new Date(2000) });
    const current = generateTestVariation({ branchName: 'develop', updatedAt: new Date(1000) });

    it.each([
      ['the main branch', [main, undefined], main],
      ['the current branch', [undefined, current], current],
      ['the current branch but main branch is more relevant', [main, current], main],
    ])('can find by %s', async (_case, [mainResult, currentResult], expected) => {
      const request = findRequest({ projectId: TEST_PROJECT.id });
      const { service, m } = await initFind(mainResult, currentResult);
      m.prisma.project.findUnique.mockReturnValueOnce(TEST_PROJECT);

      const result = await service.find(request);

      expect(m.prisma.project.findUnique).toHaveBeenCalledWith({ where: { id: request.projectId } });
      expect(service.findUnique).toHaveBeenNthCalledWith(1, keyOf(request, TEST_PROJECT.mainBranchName));
      expect(service.findUnique).toHaveBeenNthCalledWith(2, keyOf(request, request.branchName));
      expect(result).toBe(expected);
    });

    it('returns undefined when neither branch has the variation', async () => {
      const { service, m } = await initFind(null, null);
      m.prisma.project.findUnique.mockResolvedValueOnce(TEST_PROJECT);

      await expect(service.find(findRequest())).resolves.toBeUndefined();
    });

    it('only looks on the main branch when the build runs on it', async () => {
      const variation = generateTestVariation({ branchName: TEST_PROJECT.mainBranchName });
      const { service, m } = await initFind(variation);
      m.prisma.project.findUnique.mockResolvedValueOnce(TEST_PROJECT);
      const request = findRequest({ branchName: TEST_PROJECT.mainBranchName });

      const result = await service.find(request);

      expect(result).toBe(variation);
      expect(service.findUnique).toHaveBeenCalledTimes(1);
      expect(service.findUnique).toHaveBeenCalledWith(request);
    });

    it('uses sourceBranch instead of the project main branch when given', async () => {
      const { service, m } = await initFind();

      await service.find(findRequest({ branchName: 'feature', sourceBranch: 'release' }));

      expect(m.prisma.project.findUnique).not.toHaveBeenCalled();
      expect(service.findUnique).toHaveBeenNthCalledWith(1, expect.objectContaining({ branchName: 'release' }));
      expect(service.findUnique).toHaveBeenNthCalledWith(2, expect.objectContaining({ branchName: 'feature' }));
    });

    it('takes the main branch from the caller instead of reading the project', async () => {
      const { service, m } = await initFind();

      await service.find(findRequest({ branchName: 'feature' }), 'trunk');

      expect(m.prisma.project.findUnique).not.toHaveBeenCalled();
      expect(service.findUnique).toHaveBeenNthCalledWith(1, expect.objectContaining({ branchName: 'trunk' }));
      expect(service.findUnique).toHaveBeenNthCalledWith(2, expect.objectContaining({ branchName: 'feature' }));
    });

    it('reads the project main branch when neither sourceBranch nor the caller gives one', async () => {
      const { service, m } = await initFind();
      m.prisma.project.findUnique.mockResolvedValueOnce({ ...TEST_PROJECT, mainBranchName: 'trunk' });

      await service.find(findRequest({ branchName: 'feature' }));

      expect(m.prisma.project.findUnique).toHaveBeenCalledWith({ where: { id: TEST_PROJECT.id } });
      expect(service.findUnique).toHaveBeenNthCalledWith(1, expect.objectContaining({ branchName: 'trunk' }));
    });

    it('keeps the current branch variation when it is as new as the main branch one', async () => {
      const updatedAt = new Date('2024-01-01');
      const sameAgeMain = generateTestVariation({ id: 'main', updatedAt });
      const sameAgeCurrent = generateTestVariation({ id: 'current', updatedAt });
      const { service, m } = await initFind(sameAgeMain, sameAgeCurrent);
      m.prisma.project.findUnique.mockResolvedValueOnce(TEST_PROJECT);

      await expect(service.find(findRequest())).resolves.toBe(sameAgeCurrent);
    });
  });

  describe('findUnique', () => {
    it('looks the variation up by its full composite key', async () => {
      const variation = generateTestVariation();
      const { service, m } = await build();
      m.prisma.testVariation.findUnique.mockResolvedValueOnce(variation);

      const result = await service.findUnique({ ...baselineData, projectId: 'projectId', branchName: 'develop' });

      expect(result).toBe(variation);
      expect(m.prisma.testVariation.findUnique).toHaveBeenCalledWith({
        where: {
          projectId_name_browser_device_os_viewport_customTags_branchName: {
            projectId: 'projectId',
            ...baselineData,
            branchName: 'develop',
          },
        },
      });
    });
  });

  describe('create', () => {
    it('create stores the project, branch and screen', async () => {
      const { service, m } = await build();

      await service.create({ ...baselineData, projectId: 'projectId', branchName: 'develop' });

      expect(m.prisma.testVariation.create.mock.calls[0][0].data).toStrictEqual({
        project: { connect: { id: 'projectId' } },
        branchName: 'develop',
        ...baselineData,
      });
    });

    it('create stores missing optional fields as empty strings', async () => {
      const { service, m } = await build();

      await service.create({ name: 'only name', projectId: 'projectId', branchName: 'develop' });

      expect(m.prisma.testVariation.create.mock.calls[0][0].data).toMatchObject({
        name: 'only name',
        os: '',
        device: '',
        browser: '',
        viewport: '',
        customTags: '',
      });
    });
  });

  describe('update', () => {
    it('update', async () => {
      const data = { baselineName: 'baselineName', comment: 'random comment', ignoreAreas: '[]' };
      const { service, m } = await build();

      await service.update('some id', data);

      expect(m.prisma.testVariation.update).toHaveBeenCalledWith({ where: { id: 'some id' }, data });
    });

    it('update connects the test run when one is given', async () => {
      const { service, m } = await build();
      m.prisma.testVariation.update.mockResolvedValueOnce('updated');

      const result = await service.update(
        'variationId',
        { baselineName: 'baseline.png', ignoreAreas: '[]', comment: 'c' },
        'testRunId'
      );

      expect(result).toBe('updated');
      expect(m.prisma.testVariation.update).toHaveBeenCalledWith({
        where: { id: 'variationId' },
        data: {
          baselineName: 'baseline.png',
          ignoreAreas: '[]',
          comment: 'c',
          testRuns: { connect: { id: 'testRunId' } },
        },
      });
    });
  });

  describe('addBaseline', () => {
    it.each([
      ['a user', 'userId', { connect: { id: 'userId' } }],
      ['no user', undefined, undefined],
    ])('records a baseline for the test run with %s', async (_, userId, user) => {
      const { service, m } = await build();
      m.prisma.testVariation.update.mockResolvedValueOnce('updated');

      const result = await service.addBaseline({
        id: 'variationId',
        userId,
        testRunId: 'testRunId',
        baselineName: 'baseline.png',
      });

      expect(result).toBe('updated');
      expect(m.prisma.testVariation.update.mock.calls[0][0]).toStrictEqual({
        where: { id: 'variationId' },
        data: {
          baselineName: 'baseline.png',
          baselines: {
            create: {
              baselineName: 'baseline.png',
              testRun: { connect: { id: 'testRunId' } },
              user,
            },
          },
        },
      });
    });
  });

  describe('merge', () => {
    const project = TEST_PROJECT;
    const fromBranch = 'develop';
    const targetBranch = 'test';
    const source = (overrides: object = {}) =>
      generateTestVariation({ id: '123', projectId: project.id, branchName: fromBranch, ...overrides }, []);

    it('merge', async () => {
      const mergeBuild = { id: 'a9385fc1-884d-4f9f-915e-40da0e7773d5' };
      const testVariation = source();
      const testVariationSecond = source({ name: 'Test name second' });
      const testVariationNoBaseline = source({ baselineName: null });
      const testVariationTargetBranch = { ...source(), branchName: targetBranch };
      const imageBuffer = PNG.sync.write(new PNG({ width: 10, height: 10 }));
      const { service, m } = await build();
      m.builds.findOrCreate.mockResolvedValueOnce(mergeBuild);
      m.prisma.testVariation.findMany.mockResolvedValueOnce([
        testVariation,
        testVariationSecond,
        testVariationNoBaseline,
      ]);
      m.static.getImageBuffer
        .mockReturnValueOnce(imageBuffer)
        .mockReturnValueOnce(imageBuffer)
        .mockReturnValueOnce(null);
      m.prisma.project.findUnique.mockResolvedValue(project);
      service.findUnique = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      service.create = jest
        .fn()
        .mockResolvedValueOnce(testVariationTargetBranch)
        .mockResolvedValueOnce(testVariationTargetBranch);

      await service.merge(project.id, fromBranch, targetBranch);

      expect(m.builds.findOrCreate).toHaveBeenCalledWith({ branchName: targetBranch, projectId: project.id });
      expect(service.findUnique).toHaveBeenNthCalledWith(1, keyOf(testVariation, targetBranch));
      expect(service.findUnique).toHaveBeenNthCalledWith(2, keyOf(testVariationSecond, targetBranch));
      [testVariation, testVariationSecond].forEach((variation, index) =>
        expect(m.testRuns.create).toHaveBeenNthCalledWith(index + 1, {
          testVariation: testVariationTargetBranch,
          createTestRequestDto: {
            ...variation,
            branchName: targetBranch,
            buildId: mergeBuild.id,
            diffTollerancePercent: 0,
            merge: true,
            ignoreAreas: JSON.parse(variation.ignoreAreas),
          },
          imageBuffer,
        })
      );
      expect(m.testRuns.create).toHaveBeenCalledTimes(2);
      expect(m.prisma.project.findUnique).toHaveBeenCalledTimes(1);
      expect(m.testRuns.calculateDiff).toHaveBeenCalledTimes(2);
      expect(m.testRuns.calculateDiff).toHaveBeenCalledWith(project.id, undefined, imageBuffer, project);
      expect(m.builds.update).toHaveBeenCalledWith(mergeBuild.id, { isRunning: false });
    });

    it('merge reuses a variation that already lives on the target branch', async () => {
      const mergeSource = generateTestVariation({
        branchName: 'develop',
        ignoreAreas: '[{"x":1,"y":2,"width":3,"height":4}]',
      });
      const target = generateTestVariation({ id: 'target', branchName: 'master' });
      const imageBuffer = Buffer.from('png');
      const testRun = { id: 'testRunId' };
      const mergeProject = { ...TEST_PROJECT, id: 'projectId' };
      const { service, m } = await build();
      m.builds.findOrCreate.mockResolvedValueOnce({ id: 'buildId' });
      m.prisma.testVariation.findMany.mockResolvedValueOnce([mergeSource]);
      m.static.getImageBuffer.mockResolvedValueOnce(imageBuffer);
      m.testRuns.create.mockResolvedValueOnce(testRun);
      m.builds.update.mockResolvedValueOnce('stopped build');
      m.prisma.project.findUnique.mockResolvedValue(mergeProject);
      service.findUnique = jest.fn().mockResolvedValueOnce(target);
      service.create = jest.fn();

      const result = await service.merge('projectId', 'develop', 'master');

      expect(m.prisma.testVariation.findMany).toHaveBeenCalledWith({
        where: { projectId: 'projectId', branchName: 'develop' },
      });
      expect(m.static.getImageBuffer).toHaveBeenCalledWith(mergeSource.baselineName);
      expect(service.create).not.toHaveBeenCalled();
      expect(m.testRuns.create).toHaveBeenCalledWith({
        testVariation: target,
        createTestRequestDto: expect.objectContaining({
          branchName: 'master',
          buildId: 'buildId',
          merge: true,
          diffTollerancePercent: 0,
          ignoreAreas: [{ x: 1, y: 2, width: 3, height: 4 }],
        }),
        imageBuffer,
      });
      expect(m.testRuns.calculateDiff).toHaveBeenCalledWith('projectId', testRun, imageBuffer, mergeProject);
      expect(m.builds.update).toHaveBeenCalledWith('buildId', { isRunning: false });
      expect(result).toBe('stopped build');
    });

    it('merge into a deleted project answers 404 and stops its build', async () => {
      const { service, m } = await build();
      m.builds.findOrCreate.mockResolvedValueOnce({ id: 'buildId' });
      m.builds.update.mockResolvedValueOnce('stopped build');
      m.prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.merge('gone', 'develop', 'master')).rejects.toThrow(
        new NotFoundException('Project not found: gone')
      );

      expect(m.builds.update).toHaveBeenCalledWith('buildId', { isRunning: false });
      expect(m.prisma.testVariation.findMany).not.toHaveBeenCalled();
    });

    it('merge stops its build when a step fails and passes the failure on', async () => {
      const { service, m } = await build();
      m.builds.findOrCreate.mockResolvedValueOnce({ id: 'buildId' });
      m.prisma.testVariation.findMany.mockResolvedValueOnce([generateTestVariation({ branchName: 'develop' })]);
      m.static.getImageBuffer.mockResolvedValueOnce(Buffer.from('png'));
      m.testRuns.create.mockRejectedValueOnce(new Error('storage down'));
      m.builds.update.mockResolvedValueOnce('stopped build');
      m.prisma.project.findUnique.mockResolvedValue({ ...TEST_PROJECT, id: 'projectId' });
      service.findUnique = jest.fn().mockResolvedValueOnce(generateTestVariation({ branchName: 'master' }));

      await expect(service.merge('projectId', 'develop', 'master')).rejects.toThrow('storage down');

      expect(m.builds.update).toHaveBeenCalledWith('buildId', { isRunning: false });
    });
  });

  describe('delete', () => {
    const twoBaselines = [{ baselineName: 'image 1' }, { baselineName: 'image 2' }];

    it('removes the rows in one transaction before the files', async () => {
      const order: string[] = [];
      const { service, m } = await build();
      m.prisma.$transaction.mockImplementation(async (operations: Promise<unknown>[]) => {
        order.push('rows');
        return Promise.all(operations);
      });
      m.static.deleteImage.mockImplementation(async () => {
        order.push('file');
      });
      m.prisma.baseline.findMany.mockResolvedValueOnce(twoBaselines);

      await service.delete('variationId');

      expect(m.prisma.baseline.findMany).toHaveBeenCalledWith({
        where: { testVariationId: 'variationId' },
        select: { baselineName: true },
      });
      expect(m.prisma.baseline.deleteMany).toHaveBeenCalledWith({ where: { testVariationId: 'variationId' } });
      expect(m.prisma.testVariation.delete).toHaveBeenCalledWith({ where: { id: 'variationId' } });
      expect(m.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(m.static.deleteImage.mock.calls).toEqual([['image 1'], ['image 2']]);
      expect(order).toEqual(['rows', 'file', 'file']);
    });

    it('keeps the files when the rows cannot be deleted', async () => {
      const { service, m } = await build();
      m.prisma.$transaction.mockRejectedValueOnce(new Error('db down'));
      m.prisma.baseline.findMany.mockResolvedValueOnce(twoBaselines);

      await expect(service.delete('variationId')).rejects.toThrow('db down');

      expect(m.static.deleteImage).not.toHaveBeenCalled();
    });

    it('returns the deleted variation', async () => {
      const deleted = generateTestVariation({ id: 'variationId' });
      const { service, m } = await build();
      m.prisma.$transaction.mockResolvedValueOnce([{ count: 2 }, deleted]);
      m.prisma.baseline.findMany.mockResolvedValueOnce(twoBaselines);

      expect(await service.delete('variationId')).toBe(deleted);
    });

    it('delete runs no raw SQL', async () => {
      const { service, m } = await build();

      await service.delete('id');

      expect(m.prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('createOrTakeWinner', () => {
    const request = {
      projectId: 'projectId',
      branchName: 'develop',
      name: 'Test name',
      os: 'OS',
      browser: 'browser',
      viewport: 'viewport',
      device: 'device',
      customTags: '',
    };

    it('creates the variation without looking it up first', async () => {
      const created = generateTestVariation({ id: 'created' });
      const { service, m } = await build();
      m.prisma.testVariation.create.mockResolvedValueOnce(created);

      expect(await service.createOrTakeWinner(request)).toBe(created);
      expect(m.prisma.testVariation.create).toHaveBeenCalledTimes(1);
      expect(m.prisma.testVariation.findUnique).not.toHaveBeenCalled();
    });

    it('returns the variation a concurrent request created', async () => {
      const winner = generateTestVariation({ id: 'winner' });
      const { service, m } = await build();
      m.prisma.testVariation.findUnique.mockResolvedValueOnce(winner);
      m.prisma.testVariation.create.mockRejectedValueOnce(prismaError('P2002'));

      expect(await service.createOrTakeWinner(request)).toBe(winner);
      expect(m.prisma.testVariation.findUnique).toHaveBeenCalledTimes(1);
    });

    it('rethrows a non-P2002 error', async () => {
      const { service, m } = await build();
      m.prisma.testVariation.create.mockRejectedValueOnce(new Error('db down'));

      await expect(service.createOrTakeWinner(request)).rejects.toThrow('db down');
      expect(m.prisma.testVariation.findUnique).not.toHaveBeenCalled();
    });

    it('rethrows P2002 when the winner cannot be found', async () => {
      const error = prismaError('P2002');
      const { service, m } = await build();
      m.prisma.testVariation.findUnique.mockResolvedValue(null);
      m.prisma.testVariation.create.mockRejectedValueOnce(error);

      await expect(service.createOrTakeWinner(request)).rejects.toBe(error);
    });
  });

  describe('transaction client', () => {
    const txWith = (testVariation: Record<string, jest.Mock>) =>
      ({ testVariation }) as unknown as Prisma.TransactionClient;
    const idKey = {
      projectId: 'p',
      branchName: 'b',
      name: 'n',
      os: '',
      device: '',
      browser: '',
      viewport: '',
      customTags: '',
    };

    it('update uses the transaction client it is given', async () => {
      const { service, m } = await build();
      const txUpdate = jest.fn();

      await service.update('id', { comment: 'c' }, 'runId', txWith({ update: txUpdate }));

      expect(txUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'id' } }));
      expect(m.prisma.testVariation.update).not.toHaveBeenCalled();
    });

    it('addBaseline uses the transaction client it is given', async () => {
      const { service, m } = await build();
      const txUpdate = jest.fn();

      await service.addBaseline({ id: 'id', testRunId: 'runId', baselineName: 'b.png' }, txWith({ update: txUpdate }));

      expect(txUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'id' } }));
      expect(m.prisma.testVariation.update).not.toHaveBeenCalled();
    });

    it('findUnique uses the transaction client it is given', async () => {
      const { service, m } = await build();
      const txFindUnique = jest.fn();

      await service.findUnique(idKey, txWith({ findUnique: txFindUnique }));

      expect(txFindUnique).toHaveBeenCalledTimes(1);
      expect(m.prisma.testVariation.findUnique).not.toHaveBeenCalled();
    });

    it('create uses the transaction client it is given', async () => {
      const { service, m } = await build();
      const txCreate = jest.fn();

      await service.create({ projectId: 'p', branchName: 'b', name: 'n' }, txWith({ create: txCreate }));

      expect(txCreate).toHaveBeenCalledTimes(1);
      expect(m.prisma.testVariation.create).not.toHaveBeenCalled();
    });
  });
});
