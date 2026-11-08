import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { mocked } from 'jest-mock';
import { Test } from '@nestjs/testing';
import { TestRunsService } from './test-runs.service';
import { RevertDecision } from './test-run-revert.service';
import { TestRunRevertService } from './test-run-revert.service';
import { TestRunMatchingService } from './test-run-matching.service';
import { getAllIgnoreAreas, TestRunAlreadyDecidedException } from './test-runs.shared';
import { PrismaService } from '../prisma/prisma.service';
import { StaticService } from '../static/static.service';
import { Prisma, Project, TestStatus, TestRun, TestVariation } from '@prisma/client';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { TestRunResultDto } from './dto/testRunResult.dto';
import { DiffResult } from './diffResult';
import { EventsGateway } from '../shared/events/events.gateway';
import { TestVariationsService } from '../test-variations/test-variations.service';
import { TestRunDto } from '../test-runs/dto/testRun.dto';
import { generateBaseline, generateTestRun, generateTestVariation, TEST_PROJECT } from '../_data_';
import { getTestVariationUniqueData } from '../utils';
import { CompareService } from '../compare/compare.service';

jest.mock('pixelmatch');
jest.mock('./dto/testRunResult.dto');

const createMocks = () => {
  const m = {
    testRun: {
      delete: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    testVariation: { count: jest.fn() },
    baseline: { count: jest.fn().mockResolvedValue(0) },
    project: { findUnique: jest.fn() },
    build: { findUnique: jest.fn() },
    static: { getImageBuffer: jest.fn(), copyImage: jest.fn(), saveImage: jest.fn(), deleteImage: jest.fn() },
    events: { testRunUpdated: jest.fn(), testRunCreated: jest.fn(), testRunDeleted: jest.fn() },
    tv: {
      find: jest.fn(),
      findBaselineHistory: jest.fn(),
      findLatestBaselines: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      createOrTakeWinner: jest.fn(),
      findUnique: jest.fn(),
      addBaseline: jest.fn(),
    },
    revert: { revert: jest.fn() },
    matching: { getMatchingVariations: jest.fn() },
    compare: { getDiff: jest.fn(), getChangeSignature: jest.fn(), getComparator: jest.fn() },
    tx: {} as object,
    transaction: jest.fn(),
  };
  m.tx = { testRun: { updateMany: m.testRun.updateMany } };
  m.transaction.mockImplementation((callback: (client: object) => unknown) => callback(m.tx));
  return m;
};
type Mocks = ReturnType<typeof createMocks>;

const build = async () => {
  const m = createMocks();
  const module = await Test.createTestingModule({
    providers: [
      TestRunsService,
      {
        provide: PrismaService,
        useValue: {
          $transaction: m.transaction,
          testRun: m.testRun,
          testVariation: m.testVariation,
          baseline: m.baseline,
          project: m.project,
          build: m.build,
        },
      },
      {
        provide: StaticService,
        useValue: {
          ...m.static,
          deleteImages: async (names: Iterable<string | null | undefined>) => {
            for (const name of names) if (name) await m.static.deleteImage(name);
          },
        },
      },
      { provide: EventsGateway, useValue: m.events },
      { provide: TestVariationsService, useValue: m.tv },
      { provide: CompareService, useValue: m.compare },
      { provide: TestRunRevertService, useValue: m.revert },
      { provide: TestRunMatchingService, useValue: m.matching },
    ],
  }).compile();
  return { service: module.get<TestRunsService>(TestRunsService), m };
};

const prismaError = (code: string) => new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: 'test' });

const requestDto = (overrides: Partial<CreateTestRequestDto> = {}): CreateTestRequestDto => ({
  buildId: 'buildId',
  projectId: 'projectId',
  name: 'Test name',
  branchName: 'develop',
  ...overrides,
});

const okDiff: DiffResult = {
  status: TestStatus.ok,
  diffName: null,
  pixelMisMatchCount: 0,
  diffPercent: 0,
  isSameDimension: true,
};
const unresolvedDiff: DiffResult = {
  status: TestStatus.unresolved,
  diffName: 'diff image name',
  pixelMisMatchCount: 11,
  diffPercent: 22,
  isSameDimension: true,
};

const NO_VARIATION = 'No test variation found. Re-create test run';

const deletedNames = (m: Mocks) => m.static.deleteImage.mock.calls.map(([name]) => name).sort();
const updatedData = (m: Mocks) => m.testRun.update.mock.calls[0][0].data;
const diffInputs = (m: Mocks) => m.compare.getDiff.mock.calls.map(([input]) => input);

describe('TestRunsService', () => {
  const imageBuffer = Buffer.from('Image');
  const ignoreAreas = [{ x: 1, y: 2, width: 10, height: 20 }];

  const saveDiff = async (diff: DiffResult, id = 'some id') => {
    const { service, m } = await build();
    m.testRun.update.mockResolvedValueOnce(generateTestRun());
    await service.saveDiffResult(id, diff);
    return m;
  };

  it('findOne', async () => {
    const { service, m } = await build();

    await service.findOne('some id');

    expect(m.testRun.findUnique).toHaveBeenCalledWith({ where: { id: 'some id' }, include: { testVariation: true } });
  });

  describe('findOneOrThrow', () => {
    it('returns the run', async () => {
      const run = generateTestRun();
      const { service, m } = await build();
      m.testRun.findUnique.mockResolvedValueOnce(run);

      await expect(service.findOneOrThrow(run.id)).resolves.toBe(run);
    });

    it('throws NotFoundException for an unknown run', async () => {
      const { service, m } = await build();
      m.testRun.findUnique.mockResolvedValueOnce(null);

      await expect(service.findOneOrThrow('missing')).rejects.toThrow(
        new NotFoundException('Test run not found: missing')
      );
    });
  });

  describe('create', () => {
    const request = requestDto({ buildId: 'b', projectId: 'p' });

    const initCreate = async () => {
      const ctx = await build();
      ctx.m.static.saveImage.mockResolvedValueOnce('image.png');
      return ctx;
    };

    it('create', async () => {
      const createTestRequestDto = requestDto({
        os: 'OS',
        browser: 'browser',
        viewport: 'viewport',
        device: 'device',
        customTags: '',
        diffTollerancePercent: undefined,
        merge: true,
        ignoreAreas: [{ x: 1, y: 2, width: 100, height: 200 }],
      });
      const testVariation = generateTestVariation({ ignoreAreas: '[{"x":3,"y":4,"width":500,"height":600}]' });
      const testRun = generateTestRun();
      const { service, m } = await build();
      m.testRun.create.mockResolvedValueOnce(testRun);
      m.static.saveImage.mockResolvedValueOnce('image name');

      const result = await service.create({ testVariation, createTestRequestDto, imageBuffer });

      expect(m.static.saveImage).toHaveBeenCalledWith('screenshot', imageBuffer);
      expect(m.testRun.create).toHaveBeenCalledWith({
        data: {
          imageName: 'image name',
          testVariationId: testVariation.id,
          buildId: createTestRequestDto.buildId,
          projectId: createTestRequestDto.projectId,
          name: testVariation.name,
          browser: testVariation.browser,
          device: testVariation.device,
          os: testVariation.os,
          viewport: testVariation.viewport,
          customTags: testVariation.customTags,
          baselineName: testVariation.baselineName,
          ignoreAreas: testVariation.ignoreAreas,
          tempIgnoreAreas: JSON.stringify(createTestRequestDto.ignoreAreas),
          comment: testVariation.comment,
          baselineBranchName: testVariation.branchName,
          branchName: createTestRequestDto.branchName,
          diffTollerancePercent: createTestRequestDto.diffTollerancePercent,
          merge: createTestRequestDto.merge,
          status: TestStatus.new,
        },
      });
      expect(result).toBe(testRun);
    });

    it('prefers the comment of the request over the one of the variation and leaves tempIgnoreAreas to the database default when the request has none', async () => {
      const { service, m } = await initCreate();
      m.testRun.create.mockResolvedValueOnce(generateTestRun());

      const result = await service.create({
        testVariation: generateTestVariation({ comment: 'variation comment' }),
        createTestRequestDto: requestDto({ comment: 'request comment' }),
        imageBuffer,
      });

      const { data } = m.testRun.create.mock.calls[0][0];
      expect(data.comment).toBe('request comment');
      expect(data.imageName).toBe('image.png');
      expect(data.tempIgnoreAreas).toBeUndefined();
      expect(m.events.testRunCreated).toHaveBeenCalledWith(result);
    });

    it('create inserts with scalar foreign keys, no nested connect', async () => {
      const { service, m } = await initCreate();
      m.testRun.create.mockResolvedValueOnce(generateTestRun());

      await service.create({
        testVariation: generateTestVariation({ id: 'v' }),
        createTestRequestDto: request,
        imageBuffer,
      });

      const { data } = m.testRun.create.mock.calls[0][0];
      expect(data).toMatchObject({ buildId: 'b', projectId: 'p', testVariationId: 'v' });
      expect(data.build).toBeUndefined();
      expect(data.project).toBeUndefined();
      expect(data.testVariation).toBeUndefined();
    });

    it('a run whose build disappeared is a 404', async () => {
      const { service, m } = await initCreate();
      m.testRun.create.mockRejectedValueOnce(prismaError('P2003'));

      await expect(
        service.create({ testVariation: generateTestVariation(), createTestRequestDto: request, imageBuffer })
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(m.events.testRunCreated).not.toHaveBeenCalled();
    });

    it('create rethrows other errors', async () => {
      const failure = new Error('connection lost');
      const { service, m } = await initCreate();
      m.testRun.create.mockRejectedValueOnce(failure);

      await expect(
        service.create({ testVariation: generateTestVariation(), createTestRequestDto: request, imageBuffer })
      ).rejects.toBe(failure);
    });
  });

  describe('calculateDiff', () => {
    it('calculateDiff', async () => {
      const testRun = generateTestRun();
      const diffResult = { id: 'test' };
      const { service, m } = await build();
      m.compare.getDiff.mockReturnValueOnce(diffResult);
      service.saveDiffResult = jest.fn();

      await service.calculateDiff('projectId', testRun);

      expect(m.static.deleteImage).toHaveBeenCalledWith(testRun.diffName);
      expect(m.compare.getDiff).toHaveBeenCalledWith({
        projectId: 'projectId',
        data: {
          image: testRun.imageName,
          baseline: testRun.baselineName,
          ignoreAreas: getAllIgnoreAreas(testRun),
          diffTollerancePercent: testRun.diffTollerancePercent,
          saveDiffAsFile: true,
        },
      });
      expect(service.saveDiffResult).toHaveBeenCalledWith(testRun.id, diffResult);
    });

    it('compares with the permanent and temporary ignore areas together, returns the saved run and asks storage to drop the previous diff and thumbnails, missing ones included', async () => {
      const permanent = { x: 1, y: 1, width: 1, height: 1 };
      const temporary = { x: 2, y: 2, width: 2, height: 2 };
      const testRun = generateTestRun({
        ignoreAreas: JSON.stringify([permanent]),
        tempIgnoreAreas: JSON.stringify([temporary]),
      });
      const saved = generateTestRun({ id: 'saved' });
      const { service, m } = await build();
      m.compare.getDiff.mockResolvedValueOnce({ status: TestStatus.ok });
      m.testRun.update.mockResolvedValueOnce(saved);

      const result = await service.calculateDiff('projectId', testRun);

      expect(diffInputs(m)[0].data.ignoreAreas).toEqual([permanent, temporary]);
      expect(result).toBe(saved);
      expect(m.static.deleteImage.mock.calls).toEqual([[testRun.diffName], [null], [null]]);
    });

    it('calculateDiff passes the bytes it is given', async () => {
      const { service, m } = await build();
      m.compare.getDiff.mockResolvedValueOnce(okDiff);
      m.testRun.update.mockResolvedValueOnce({});

      await service.calculateDiff('projectId', generateTestRun(), imageBuffer);

      expect(diffInputs(m)[0].data.imageBuffer).toBe(imageBuffer);
    });

    it('calculateDiff hands the project it is given to the comparison', async () => {
      const { service, m } = await build();
      m.compare.getDiff.mockResolvedValueOnce(okDiff);
      m.testRun.update.mockResolvedValueOnce({});

      await service.calculateDiff('projectId', generateTestRun(), imageBuffer, TEST_PROJECT);

      expect(diffInputs(m)[0].project).toBe(TEST_PROJECT);
    });

    it.each([
      ['unreadable', '{}', 'not json'],
      ['null', 'null', 'null'],
    ])('treats %s stored ignore areas as none', async (_case, stored, temporary) => {
      const testRun = generateTestRun({ ignoreAreas: stored, tempIgnoreAreas: temporary });
      const { service, m } = await build();
      m.compare.getDiff.mockResolvedValueOnce(okDiff);
      m.testRun.update.mockResolvedValueOnce(testRun);

      await service.calculateDiff('projectId', testRun);

      expect(diffInputs(m)[0].data.ignoreAreas).toEqual([]);
    });
  });

  describe('saveDiffResult', () => {
    it('stores the change signature the comparison produced', async () => {
      const changeSignature = { threshold: 0.1, includeAA: true, signature: [0.25, 0.75] };

      const m = await saveDiff({ ...unresolvedDiff, changeSignature });

      expect(updatedData(m)).toMatchObject({ changeSignature: JSON.stringify(changeSignature) });
    });

    it('with results', async () => {
      const diff: DiffResult = {
        ...unresolvedDiff,
        vlmDescription: 'VLM detected significant color differences in the header section',
      };

      const m = await saveDiff(diff);

      expect(m.testRun.update).toHaveBeenCalledWith({
        where: { id: 'some id' },
        data: {
          status: diff.status,
          diffName: diff.diffName,
          pixelMisMatchCount: diff.pixelMisMatchCount,
          diffPercent: diff.diffPercent,
          vlmDescription: diff.vlmDescription,
          changeSignature: null,
          imageThumbnailName: null,
          diffThumbnailName: null,
          noiseAnalysis: Prisma.DbNull,
        },
      });
      expect(m.events.testRunUpdated).toHaveBeenCalled();
    });

    it('drops a stored noise analysis because it belongs to the previous diff', async () => {
      const m = await saveDiff(unresolvedDiff);

      expect(updatedData(m).noiseAnalysis).toBe(Prisma.DbNull);
    });

    it('clears the analysis of a previous comparison when this one has none', async () => {
      const m = await saveDiff(okDiff, 'id');

      expect(updatedData(m)).toEqual({
        diffName: null,
        pixelMisMatchCount: 0,
        diffPercent: 0,
        status: TestStatus.ok,
        vlmDescription: null,
        changeSignature: null,
        imageThumbnailName: null,
        diffThumbnailName: null,
        noiseAnalysis: Prisma.DbNull,
      });
    });
  });

  it('findMany', async () => {
    const testRun = generateTestRun({ vlmDescription: 'VLM analysis completed' });
    const { service, m } = await build();
    m.testRun.findMany.mockResolvedValueOnce([testRun]);

    const result = await service.findMany('some id');

    expect(m.testRun.findMany).toHaveBeenCalledWith({ where: { buildId: 'some id' } });
    expect(result).toEqual([new TestRunDto(testRun)]);
  });

  describe('delete', () => {
    it('delete', async () => {
      const testRun = generateTestRun({ id: 'some id', diffName: 'diffName', imageName: 'imageName' });
      const { service, m } = await build();
      m.testRun.delete.mockResolvedValueOnce(testRun);

      const result = await service.delete('some id');

      expect(m.static.deleteImage).toHaveBeenCalledWith(testRun.diffName);
      expect(m.static.deleteImage).toHaveBeenCalledWith(testRun.imageName);
      expect(m.testRun.delete).toHaveBeenCalledWith({ where: { id: 'some id' } });
      expect(m.events.testRunDeleted).toHaveBeenCalledWith(testRun);
      expect(result).toBe(testRun);
    });

    it('delete not found', async () => {
      const { service, m } = await build();
      m.testRun.delete.mockRejectedValueOnce(prismaError('P2025'));

      const result = await service.delete('some id');

      expect(m.static.deleteImage).not.toHaveBeenCalled();
      expect(m.events.testRunDeleted).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('delete removes the row before the images', async () => {
      const order: string[] = [];
      const testRun = generateTestRun();
      const { service, m } = await build();
      m.testRun.delete.mockImplementationOnce(async () => {
        order.push('row');
        return testRun;
      });
      m.static.deleteImage.mockImplementation(() => {
        order.push('image');
      });

      await service.delete(testRun.id);

      expect(order).toEqual(['row', 'image', 'image']);
    });

    it.each([
      ['another prisma error', prismaError('P2003')],
      ['any other error', new Error('connection lost')],
      ['a non-prisma error carrying the P2025 code', Object.assign(new Error('gone'), { code: 'P2025' })],
    ])('rethrows %s and announces nothing', async (_case, error) => {
      const { service, m } = await build();
      m.testRun.delete.mockRejectedValueOnce(error);

      await expect(service.delete('id')).rejects.toBe(error);

      expect(m.events.testRunDeleted).not.toHaveBeenCalled();
      expect(m.static.deleteImage).not.toHaveBeenCalled();
    });
  });

  describe('thumbnails', () => {
    const thumbnailed = (overrides: Partial<TestRun> = {}) =>
      generateTestRun({
        diffName: 'old-diff.png',
        imageThumbnailName: 'old-image.thumb.png',
        diffThumbnailName: 'old-diff.thumb.png',
        ...overrides,
      });

    it('stores the names the comparison saved them under', async () => {
      const m = await saveDiff({
        ...unresolvedDiff,
        diffName: 'diff.png',
        imageThumbnailName: 'image.thumb.png',
        diffThumbnailName: 'diff.thumb.png',
      });

      expect(updatedData(m)).toMatchObject({
        imageThumbnailName: 'image.thumb.png',
        diffThumbnailName: 'diff.thumb.png',
      });
    });

    it('removes the previous ones when the diff is recalculated', async () => {
      const testRun = thumbnailed();
      const { service, m } = await build();
      m.compare.getDiff.mockResolvedValueOnce({ status: TestStatus.ok });
      m.testRun.update.mockResolvedValueOnce(testRun);

      await service.calculateDiff('projectId', testRun);

      expect(deletedNames(m)).toEqual(['old-diff.png', 'old-diff.thumb.png', 'old-image.thumb.png']);
    });

    it('keeps the previous ones when the comparison fails', async () => {
      const { service, m } = await build();
      m.compare.getDiff.mockRejectedValueOnce(new Error('storage is down'));

      await expect(service.calculateDiff('projectId', thumbnailed())).rejects.toThrow('storage is down');

      expect(m.static.deleteImage).not.toHaveBeenCalled();
    });

    it('removes them with the run they belong to', async () => {
      const testRun = thumbnailed({
        imageName: 'image.png',
        diffName: 'diff.png',
        imageThumbnailName: 'image.thumb.png',
        diffThumbnailName: 'diff.thumb.png',
      });
      const { service, m } = await build();
      m.testRun.findUnique.mockResolvedValueOnce(testRun);
      m.testRun.delete.mockResolvedValueOnce(testRun);

      await service.delete(testRun.id);

      expect(deletedNames(m)).toEqual(['diff.png', 'diff.thumb.png', 'image.png', 'image.thumb.png']);
    });
  });

  describe('ignore areas and comments', () => {
    const findsVariation = (
      m: Mocks,
      testVariationId: string | null = 'testVariationId',
      variationBranch = 'develop'
    ) =>
      m.testRun.findUnique.mockResolvedValue({
        branchName: 'develop',
        testVariationId,
        testVariation: testVariationId && {
          id: testVariationId,
          branchName: variationBranch,
          projectId: 'someProjectId',
        },
      });

    it('updateIgnoreAreas', async () => {
      const testRun = { id: 'testRunId', testVariationId: 'testVariationId', ignoreAreas: JSON.stringify(ignoreAreas) };
      const { service, m } = await build();
      m.testRun.update.mockResolvedValueOnce(testRun);
      m.tv.update.mockResolvedValueOnce({ id: 'testVariationId', projectId: 'someProjectId' });
      findsVariation(m);
      service.calculateDiff = jest.fn();

      await service.updateIgnoreAreas(testRun.id, ignoreAreas);

      expect(m.testRun.update).toHaveBeenCalledWith({
        where: { id: testRun.id },
        data: { ignoreAreas: JSON.stringify(ignoreAreas) },
      });
      expect(m.tv.update).toHaveBeenCalledWith(testRun.testVariationId, { ignoreAreas: testRun.ignoreAreas });
      expect(service.calculateDiff).toHaveBeenCalledWith('someProjectId', testRun);
    });

    it('returns the recalculated run', async () => {
      const recalculated = generateTestRun({ id: 'recalculated' });
      const { service, m } = await build();
      m.testRun.update.mockResolvedValueOnce(generateTestRun());
      m.tv.update.mockResolvedValueOnce(generateTestVariation({ projectId: 'p' }));
      findsVariation(m, 'v');
      service.calculateDiff = jest.fn().mockResolvedValueOnce(recalculated);

      expect(await service.updateIgnoreAreas('id', ignoreAreas)).toBe(recalculated);
    });

    describe('addIgnoreAreas', () => {
      const newArea = { x: 5, y: 6, width: 7, height: 8 };

      it.each([
        ['appends to the existing areas', JSON.stringify(ignoreAreas), [...ignoreAreas, newArea]],
        ['starts from none when they are null', 'null', [newArea]],
      ])('%s', async (_case, stored, expected) => {
        const updated = generateTestRun({ id: 'updated' });
        const { service, m } = await build();
        m.testRun.findUnique.mockResolvedValueOnce(generateTestRun({ ignoreAreas: stored }));
        service.updateIgnoreAreas = jest.fn().mockResolvedValueOnce(updated);

        const result = await service.addIgnoreAreas('id', [newArea]);

        expect(m.testRun.findUnique).toHaveBeenCalledWith({ where: { id: 'id' }, include: { testVariation: true } });
        expect(service.updateIgnoreAreas).toHaveBeenCalledWith('id', expected);
        expect(result).toBe(updated);
      });
    });

    it('update', async () => {
      const testRun = { id: 'testRunId', testVariationId: 'testVariationId' };
      const { service, m } = await build();
      m.testRun.update.mockResolvedValueOnce(testRun);
      findsVariation(m);

      await service.update(testRun.id, { comment: 'random comment' });

      expect(m.testRun.update).toHaveBeenCalledWith({
        where: { id: testRun.id },
        data: { comment: 'random comment' },
      });
      expect(m.tv.update).toHaveBeenCalledWith(testRun.testVariationId, { comment: 'random comment' });
      expect(m.events.testRunUpdated).toHaveBeenCalledWith(testRun);
    });

    it('returns the updated run', async () => {
      const testRun = generateTestRun();
      const { service, m } = await build();
      m.testRun.update.mockResolvedValueOnce(testRun);
      findsVariation(m, 'v');

      expect(await service.update(testRun.id, { comment: 'c' })).toBe(testRun);
    });

    it('update hands only the comment to the variation', async () => {
      const { service, m } = await build();
      m.testRun.update.mockResolvedValueOnce(generateTestRun());
      findsVariation(m, 'v');

      await service.update('id', { comment: 'c', baselineName: 'evil.png', ignoreAreas: 'not json' } as never);

      expect(m.tv.update).toHaveBeenCalledWith('v', { comment: 'c' });
    });

    describe('of a feature-branch run compared against the main branch variation', () => {
      it('updateIgnoreAreas changes only the run and diffs it in the variation project', async () => {
        const testRun = generateTestRun({ id: 'testRunId', ignoreAreas: JSON.stringify(ignoreAreas) });
        const { service, m } = await build();
        m.testRun.update.mockResolvedValueOnce(testRun);
        findsVariation(m, 'mainVariationId', 'master');
        service.calculateDiff = jest.fn();

        await service.updateIgnoreAreas(testRun.id, ignoreAreas);

        expect(m.testRun.update).toHaveBeenCalledWith({
          where: { id: testRun.id },
          data: { ignoreAreas: JSON.stringify(ignoreAreas) },
        });
        expect(m.tv.update).not.toHaveBeenCalled();
        expect(service.calculateDiff).toHaveBeenCalledWith('someProjectId', testRun);
      });

      it('update changes only the comment of the run', async () => {
        const testRun = generateTestRun({ id: 'testRunId' });
        const { service, m } = await build();
        m.testRun.update.mockResolvedValueOnce(testRun);
        findsVariation(m, 'mainVariationId', 'master');

        await service.update(testRun.id, { comment: 'c' });

        expect(m.testRun.update).toHaveBeenCalledWith({ where: { id: testRun.id }, data: { comment: 'c' } });
        expect(m.tv.update).not.toHaveBeenCalled();
        expect(m.events.testRunUpdated).toHaveBeenCalledWith(testRun);
      });
    });

    describe.each([
      ['update', (svc: TestRunsService) => svc.update('id', { comment: 'c' })],
      ['updateIgnoreAreas', (svc: TestRunsService) => svc.updateIgnoreAreas('id', ignoreAreas)],
    ])('%s of a run that cannot be edited', (_name, call) => {
      it('fails with a conflict before writing anything when the run has no variation', async () => {
        const { service, m } = await build();
        findsVariation(m, null);

        const result = call(service);

        await expect(result).rejects.toBeInstanceOf(ConflictException);
        await expect(result).rejects.toThrow(NO_VARIATION);
        expect(m.testRun.update).not.toHaveBeenCalled();
      });

      it('fails with NotFoundException before writing anything for an unknown id', async () => {
        const { service, m } = await build();
        m.testRun.findUnique.mockResolvedValue(null);

        await expect(call(service)).rejects.toBeInstanceOf(NotFoundException);
        expect(m.testRun.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('postTestRun', () => {
    const createTestRequestDto = requestDto();

    const initPostService = async ({
      project = { ...TEST_PROJECT, autoApproveFeature: false },
      existingVariation = null,
      previousRuns = [],
      buildRow = { projectId: createTestRequestDto.projectId },
    }: {
      project?: Project | null;
      existingVariation?: TestVariation | null;
      previousRuns?: TestRun[];
      buildRow?: { projectId: string } | null;
    } = {}) => {
      const testRun = generateTestRun();
      const diffed = generateTestRun({ status: TestStatus.unresolved });
      const createdVariation = generateTestVariation({ id: 'created variation' });
      const { service, m } = await build();
      m.project.findUnique.mockResolvedValue(project);
      m.build.findUnique.mockResolvedValue(buildRow);
      m.tv.find.mockResolvedValue(existingVariation);
      m.tv.createOrTakeWinner.mockResolvedValue(createdVariation);
      m.testRun.findMany.mockResolvedValue(previousRuns);
      m.static.saveImage.mockResolvedValue('img.png');
      service.delete = jest.fn();
      const insert = jest.fn().mockResolvedValue(testRun);
      service['insertTestRun'] = insert;
      service.calculateDiff = jest.fn().mockResolvedValue(diffed);
      service['tryAutoApproveByPastBaselines'] = jest.fn();
      service['tryAutoApproveByNewBaselines'] = jest.fn();
      return { service, m, testRun, diffed, createdVariation, insert };
    };
    type PostContext = Awaited<ReturnType<typeof initPostService>>;
    const post = (service: TestRunsService) => service.postTestRun({ createTestRequestDto, imageBuffer });

    beforeEach(() => mocked(TestRunResultDto).mockClear());

    it('postTestRun', async () => {
      const request = requestDto({
        os: 'OS',
        browser: 'browser',
        viewport: 'viewport',
        device: 'device',
        customTags: 'customTags',
        comment: 'new comment',
      });
      const testVariation = generateTestVariation();
      const previousRun = generateTestRun({ id: 'previous' });
      const { service, m, insert, testRun, diffed } = await initPostService({
        project: TEST_PROJECT,
        existingVariation: testVariation,
        previousRuns: [previousRun],
      });
      const afterPast = generateTestRun({ id: 'after past' });
      const afterNew = generateTestRun({ id: 'after new' });
      service['tryAutoApproveByPastBaselines'] = jest.fn().mockResolvedValueOnce(afterPast);
      service['tryAutoApproveByNewBaselines'] = jest.fn().mockResolvedValueOnce(afterNew);

      await service.postTestRun({ createTestRequestDto: request, imageBuffer });

      expect(m.tv.find).toHaveBeenCalledWith(request, TEST_PROJECT.mainBranchName);
      expect(m.testRun.findMany).toHaveBeenCalledWith({
        where: {
          buildId: request.buildId,
          ...getTestVariationUniqueData(request),
          branchName: request.branchName,
          NOT: { OR: [{ status: TestStatus.approved }, { status: TestStatus.autoApproved }] },
        },
      });
      expect(service.delete).toHaveBeenCalledWith(previousRun.id);
      expect(insert).toHaveBeenCalledWith({ testVariation, createTestRequestDto: request, imageName: 'img.png' });
      expect(service.calculateDiff).toHaveBeenCalledWith(request.projectId, testRun, imageBuffer, TEST_PROJECT);
      expect(service['tryAutoApproveByPastBaselines']).toHaveBeenCalledWith({
        testVariation,
        testRun: diffed,
        project: TEST_PROJECT,
        imageBuffer,
      });
      expect(service['tryAutoApproveByNewBaselines']).toHaveBeenCalledWith({
        testVariation,
        testRun: afterPast,
        project: TEST_PROJECT,
        imageBuffer,
      });
      expect(mocked(TestRunResultDto)).toHaveBeenCalledWith(afterNew, testVariation);
    });

    it('creates the test variation when there is none yet', async () => {
      const { service, m, testRun, diffed, createdVariation, insert } = await initPostService();

      await post(service);

      expect(m.tv.createOrTakeWinner).toHaveBeenCalledWith(createTestRequestDto);
      expect(m.static.saveImage).toHaveBeenCalledWith('screenshot', imageBuffer);
      expect(insert).toHaveBeenCalledWith({
        testVariation: createdVariation,
        createTestRequestDto,
        imageName: 'img.png',
      });
      expect(service.calculateDiff).toHaveBeenCalledWith(
        createTestRequestDto.projectId,
        testRun,
        imageBuffer,
        expect.objectContaining({ id: TEST_PROJECT.id })
      );
      expect(mocked(TestRunResultDto)).toHaveBeenCalledWith(diffed, createdVariation);
    });

    it('deletes nothing when there is no previous unapproved run', async () => {
      const { service } = await initPostService({ existingVariation: generateTestVariation() });

      await post(service);

      expect(service.delete).not.toHaveBeenCalled();
    });

    it('only deletes the first previous unapproved run', async () => {
      const { service } = await initPostService({
        existingVariation: generateTestVariation(),
        previousRuns: [generateTestRun({ id: 'first' }), generateTestRun({ id: 'second' })],
      });

      await post(service);

      expect(service.delete).toHaveBeenCalledTimes(1);
      expect(service.delete).toHaveBeenCalledWith('first');
    });

    it('skips auto approval when the project has it turned off', async () => {
      const variation = generateTestVariation();
      const { service, diffed } = await initPostService({ existingVariation: variation });

      await post(service);

      expect(service['tryAutoApproveByPastBaselines']).not.toHaveBeenCalled();
      expect(service['tryAutoApproveByNewBaselines']).not.toHaveBeenCalled();
      expect(mocked(TestRunResultDto)).toHaveBeenCalledWith(diffed, variation);
    });

    it('chains the two auto approvals, each one seeing the result of the previous step', async () => {
      const variation = generateTestVariation();
      const project = { ...TEST_PROJECT, autoApproveFeature: true };
      const { service, diffed } = await initPostService({ project, existingVariation: variation });
      const afterPast = generateTestRun({ id: 'after past' });
      const afterNew = generateTestRun({ id: 'after new' });
      service['tryAutoApproveByPastBaselines'] = jest.fn().mockResolvedValueOnce(afterPast);
      service['tryAutoApproveByNewBaselines'] = jest.fn().mockResolvedValueOnce(afterNew);

      await post(service);

      expect(service['tryAutoApproveByPastBaselines']).toHaveBeenCalledWith({
        testVariation: variation,
        testRun: diffed,
        project,
        imageBuffer,
      });
      expect(service['tryAutoApproveByNewBaselines']).toHaveBeenCalledWith({
        testVariation: variation,
        testRun: afterPast,
        project,
        imageBuffer,
      });
      expect(mocked(TestRunResultDto)).toHaveBeenCalledWith(afterNew, variation);
    });

    it('throws NotFoundException before storing anything when the project does not exist', async () => {
      const { service, m } = await initPostService({ project: null, existingVariation: generateTestVariation() });

      await expect(post(service)).rejects.toThrow(
        new NotFoundException(`Project not found: ${createTestRequestDto.projectId}`)
      );
      expect(m.static.saveImage).not.toHaveBeenCalled();
    });

    describe('storing the screenshot alongside the lookups', () => {
      it('stores the screenshot while the variation is being looked up', async () => {
        let resolve!: (value: TestVariation) => void;
        const { service, m } = await initPostService();
        m.tv.find.mockReturnValueOnce(new Promise<TestVariation>((r) => (resolve = r)));

        const posting = post(service);
        await new Promise(setImmediate);

        expect(m.static.saveImage).toHaveBeenCalledWith('screenshot', imageBuffer);
        resolve(generateTestVariation());
        await posting;
      });

      it.each<[string, Parameters<typeof initPostService>[0], (ctx: PostContext, failure: Error) => void]>([
        ['the variation lookup fails', {}, ({ m }, failure) => m.tv.find.mockRejectedValueOnce(failure)],
        [
          'the previous run lookup fails',
          { existingVariation: generateTestVariation() },
          ({ m }, failure) => m.testRun.findMany.mockRejectedValueOnce(failure),
        ],
        [
          'the previous run cannot be deleted',
          { existingVariation: generateTestVariation(), previousRuns: [generateTestRun({ id: 'previous' })] },
          ({ service }, failure) => {
            service.delete = jest.fn().mockRejectedValueOnce(failure);
          },
        ],
      ])('removes the stored screenshot when %s', async (_case, options, arrange) => {
        const failure = new Error('lookup failed');
        const ctx = await initPostService(options);
        arrange(ctx, failure);

        await expect(post(ctx.service)).rejects.toBe(failure);

        expect(ctx.m.static.deleteImage).toHaveBeenCalledWith('img.png');
        expect(ctx.insert).not.toHaveBeenCalled();
      });

      it('passes the save error on without removing anything', async () => {
        const failure = new Error('not a png');
        const { service, m, insert } = await initPostService({ existingVariation: generateTestVariation() });
        m.static.saveImage.mockRejectedValueOnce(failure);

        await expect(post(service)).rejects.toBe(failure);

        expect(m.static.deleteImage).not.toHaveBeenCalled();
        expect(insert).not.toHaveBeenCalled();
      });

      it('removes the stored screenshot when the insert fails', async () => {
        const failure = new Error('insert failed');
        const { service, m, insert } = await initPostService({ existingVariation: generateTestVariation() });
        insert.mockRejectedValueOnce(failure);

        await expect(post(service)).rejects.toBe(failure);

        expect(m.static.deleteImage).toHaveBeenCalledWith('img.png');
      });

      it('deletes the previous unapproved run before inserting', async () => {
        const order: string[] = [];
        const { service, insert } = await initPostService({
          existingVariation: generateTestVariation(),
          previousRuns: [generateTestRun({ id: 'previous' })],
        });
        service.delete = jest.fn(async (id: string) => {
          order.push(`delete ${id}`);
          return undefined;
        });
        insert.mockImplementationOnce(async () => {
          order.push('insert');
          return generateTestRun();
        });

        await post(service);

        expect(order).toEqual(['delete previous', 'insert']);
      });
    });

    it('postTestRun hands the uploaded bytes to the diff', async () => {
      const { service, testRun } = await initPostService({ existingVariation: generateTestVariation() });

      await post(service);

      expect(service.calculateDiff).toHaveBeenCalledWith(
        createTestRequestDto.projectId,
        testRun,
        imageBuffer,
        expect.objectContaining({ id: TEST_PROJECT.id })
      );
      expect(service.calculateDiff).toHaveBeenCalledTimes(1);
    });

    it('rejects an unknown build before storing anything', async () => {
      const { service, m } = await initPostService({ buildRow: null, existingVariation: generateTestVariation() });

      await expect(post(service)).rejects.toThrow(
        new NotFoundException(`Build not found: ${createTestRequestDto.buildId}`)
      );
      expect(m.static.saveImage).not.toHaveBeenCalled();
    });

    describe('a build of another project', () => {
      const message = `Build ${createTestRequestDto.buildId} does not belong to project ${createTestRequestDto.projectId}`;

      it('is accepted with a warning', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        const { service, diffed, createdVariation } = await initPostService({ buildRow: { projectId: 'other' } });

        await post(service);

        expect(warn).toHaveBeenCalledWith(message);
        expect(mocked(TestRunResultDto)).toHaveBeenCalledWith(diffed, createdVariation);
        warn.mockRestore();
      });
    });

    it("fails before storing anything when the project's comparator cannot run here", async () => {
      const { service, m, insert } = await initPostService({ existingVariation: generateTestVariation() });
      m.compare.getComparator.mockImplementation(() => {
        throw new Error('Odiff can only be used with HDD static service.');
      });

      await expect(post(service)).rejects.toThrow('Odiff can only be used with HDD static service.');
      expect(m.static.saveImage).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
      expect(service.delete).not.toHaveBeenCalled();
    });
  });

  describe('revert', () => {
    it('hands the ids and decision to the revert service', async () => {
      const { service, m } = await build();

      await service.revert(['a', 'b'], RevertDecision.approve);

      expect(m.revert.revert).toHaveBeenCalledWith(['a', 'b'], RevertDecision.approve);
    });
  });

  describe('getMatchingVariations', () => {
    it('matches the stored test run', async () => {
      const { service, m } = await build();
      const run = generateTestRun();
      const matches = { variations: [], skipped: [] };
      m.testRun.findUnique.mockResolvedValueOnce(run);
      m.matching.getMatchingVariations.mockResolvedValueOnce(matches);

      await expect(service.getMatchingVariations(run.id)).resolves.toBe(matches);

      expect(m.matching.getMatchingVariations).toHaveBeenCalledWith(run);
    });

    it('throws for an unknown test run', async () => {
      const { service, m } = await build();
      m.testRun.findUnique.mockResolvedValueOnce(null);

      await expect(service.getMatchingVariations('missing')).rejects.toThrow(
        new NotFoundException('Test run not found: missing')
      );
    });
  });

  describe('reject', () => {
    const initRejectService = async (before: TestRun | null, after?: TestRun, count = 1) => {
      const ctx = await build();
      ctx.m.testRun.findUnique.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
      ctx.m.testRun.updateMany.mockResolvedValue({ count });
      return ctx;
    };

    it('reject records the previous status', async () => {
      const run = generateTestRun({ status: TestStatus.unresolved });
      const rejected = { ...run, status: TestStatus.failed, statusBeforeDecision: TestStatus.unresolved };
      const { service, m } = await initRejectService(run, rejected);

      const result = await service.reject(run.id);

      expect(m.testRun.updateMany).toHaveBeenCalledWith({
        where: { id: run.id, status: TestStatus.unresolved },
        data: { status: TestStatus.failed, statusBeforeDecision: TestStatus.unresolved },
      });
      expect(m.events.testRunUpdated).toHaveBeenCalledWith(rejected);
      expect(result).toBe(rejected);
    });

    it('rejecting a failed run is a 409 and changes nothing', async () => {
      const run = generateTestRun({ status: TestStatus.failed });
      const { service, m } = await initRejectService(run);

      await expect(service.reject(run.id)).rejects.toThrow(
        new TestRunAlreadyDecidedException(`Test run ${run.id} is already rejected`)
      );

      expect(m.testRun.updateMany).not.toHaveBeenCalled();
      expect(m.events.testRunUpdated).not.toHaveBeenCalled();
    });

    it('reject of an unknown run is a 404', async () => {
      const { service, m } = await initRejectService(null);

      await expect(service.reject('missing')).rejects.toThrow(new NotFoundException('Test run not found: missing'));

      expect(m.testRun.updateMany).not.toHaveBeenCalled();
    });

    it('a lost race is a 409 and emits nothing', async () => {
      const run = generateTestRun({ status: TestStatus.unresolved });
      const { service, m } = await initRejectService(run, undefined, 0);

      await expect(service.reject(run.id)).rejects.toThrow(
        new TestRunAlreadyDecidedException(`Test run ${run.id} was changed by someone else meanwhile`)
      );

      expect(m.events.testRunUpdated).not.toHaveBeenCalled();
    });
  });

  describe('approve', () => {
    const copiedBaselineName = 'copied.baseline.png';

    const initApproveService = async (
      testRun: object | null,
      { updateManyCount = 1, baselineCount = 0 }: { updateManyCount?: number; baselineCount?: number } = {}
    ) => {
      const ctx = await build();
      ctx.m.testRun.findUnique.mockResolvedValue(testRun);
      ctx.m.testRun.updateMany.mockResolvedValue({ count: updateManyCount });
      ctx.m.baseline.count.mockResolvedValue(baselineCount);
      ctx.m.static.copyImage.mockResolvedValue(copiedBaselineName);
      return ctx;
    };

    const mainVariation = generateTestVariation({ id: 'main variation', branchName: 'master' });
    const sameBranchRun = (overrides: Partial<TestRun> = {}) => ({
      ...generateTestRun({ branchName: 'master', baselineBranchName: 'master', ...overrides }),
      testVariation: mainVariation,
    });
    const featureRun = (overrides: Partial<TestRun> = {}) => ({
      ...generateTestRun({ branchName: 'feature', baselineBranchName: 'master', ...overrides }),
      testVariation: mainVariation,
    });
    const expectClaim = (m: Mocks, run: TestRun, status: TestStatus) =>
      expect(m.testRun.updateMany).toHaveBeenCalledWith({
        where: { id: run.id, status: run.status },
        data: { status, statusBeforeDecision: run.status },
      });
    const expectNoWrites = (m: Mocks) => {
      expect(m.static.copyImage).not.toHaveBeenCalled();
      expect(m.tv.addBaseline).not.toHaveBeenCalled();
      expect(m.testRun.updateMany).not.toHaveBeenCalled();
    };

    it('approve of a run without variation is a 409', async () => {
      const { service, m } = await initApproveService({ ...generateTestRun(), testVariation: null });

      const result = service.approve('id');

      await expect(result).rejects.toBeInstanceOf(ConflictException);
      await expect(result).rejects.toThrow(NO_VARIATION);
      expect(m.static.copyImage).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the run does not exist', async () => {
      const { service } = await initApproveService(null);

      await expect(service.approve('id')).rejects.toThrow(new NotFoundException('Test run not found: id'));
    });

    it('copies the image as the new baseline of the same-branch variation and marks the run approved', async () => {
      const testRun = sameBranchRun({ imageName: 'image.png' });
      const { service, m } = await initApproveService(testRun);

      const result = await service.approve(testRun.id, false, false, 'user id');

      expect(m.static.copyImage).toHaveBeenCalledWith('baseline', 'image.png');
      expect(m.tv.findUnique).not.toHaveBeenCalled();
      expect(m.tv.addBaseline).toHaveBeenCalledWith(
        { id: mainVariation.id, userId: 'user id', testRunId: testRun.id, baselineName: copiedBaselineName },
        expect.anything()
      );
      expectClaim(m, testRun, TestStatus.approved);
      expect(m.events.testRunUpdated).toHaveBeenCalledWith(testRun);
      expect(result).toBe(testRun);
    });

    it('claims the run and adds the baseline in one transaction', async () => {
      const testRun = sameBranchRun({ status: TestStatus.failed });
      const { service, m } = await initApproveService(testRun);

      await service.approve(testRun.id);

      expectClaim(m, testRun, TestStatus.approved);
      const [, tx] = m.tv.addBaseline.mock.calls[0];
      expect(tx).toHaveProperty('testRun.updateMany', m.testRun.updateMany);
      expect(m.events.testRunUpdated).toHaveBeenCalledWith(testRun);
    });

    it('approve records the status it decided from', async () => {
      const testRun = sameBranchRun({ status: TestStatus.unresolved });
      const { service, m } = await initApproveService(testRun);

      await service.approve(testRun.id);

      expectClaim(m, testRun, TestStatus.approved);
    });

    it('creates a feature-branch variation when approving a feature-branch run against the main baseline', async () => {
      const testRun = featureRun({
        baselineName: 'old.baseline.png',
        ignoreAreas: '[{"x":1}]',
        comment: 'run comment',
      });
      const { service, m } = await initApproveService(testRun);
      const created = generateTestVariation({ id: 'created feature variation', branchName: 'feature' });
      const updated = generateTestVariation({ id: 'updated feature variation', branchName: 'feature' });
      m.tv.findUnique.mockResolvedValueOnce(null);
      m.tv.create.mockResolvedValueOnce(created);
      m.tv.update.mockResolvedValueOnce(updated);
      const key = { projectId: mainVariation.projectId, branchName: 'feature', ...getTestVariationUniqueData(testRun) };

      await service.approve(testRun.id, false, false, 'user id');

      expect(m.tv.findUnique).toHaveBeenCalledWith(key, expect.anything());
      expect(m.tv.create).toHaveBeenCalledWith(key, expect.anything());
      expect(m.tv.update).toHaveBeenCalledWith(
        created.id,
        { ignoreAreas: '[{"x":1}]', comment: 'run comment' },
        testRun.id,
        expect.anything()
      );
      expect(m.tv.addBaseline).toHaveBeenCalledWith(
        { id: updated.id, userId: 'user id', testRunId: testRun.id, baselineName: copiedBaselineName, before: created },
        expect.anything()
      );
      expectClaim(m, testRun, TestStatus.approved);
    });

    it('reuses the existing feature-branch variation', async () => {
      const testRun = featureRun();
      const { service, m } = await initApproveService(testRun);
      const existing = generateTestVariation({ id: 'existing feature variation', branchName: 'feature' });
      m.tv.findUnique.mockResolvedValueOnce(existing);
      m.tv.update.mockResolvedValueOnce(existing);

      await service.approve(testRun.id);

      expect(m.tv.create).not.toHaveBeenCalled();
      expect(m.tv.update).toHaveBeenCalledWith(existing.id, expect.any(Object), testRun.id, expect.anything());
      expect(m.tv.addBaseline).toHaveBeenCalledWith(
        expect.objectContaining({ id: existing.id, userId: undefined, before: existing }),
        expect.anything()
      );
    });

    it('adds the baseline straight to the main variation when merging', async () => {
      const testRun = featureRun();
      const { service, m } = await initApproveService(testRun);

      await service.approve(testRun.id, true);

      expect(m.tv.findUnique).not.toHaveBeenCalled();
      expect(m.tv.update).not.toHaveBeenCalled();
      expect(m.tv.addBaseline).toHaveBeenCalledWith(
        expect.objectContaining({ id: mainVariation.id, baselineName: copiedBaselineName }),
        expect.anything()
      );
      expectClaim(m, testRun, TestStatus.approved);
    });

    it('auto approving a feature-branch run copies no baseline image', async () => {
      const testRun = featureRun();
      const { service, m } = await initApproveService(testRun);

      await service.approve(testRun.id, false, true);

      expect(m.static.copyImage).not.toHaveBeenCalled();
      expect(m.tv.findUnique).not.toHaveBeenCalled();
      expect(m.tv.addBaseline).not.toHaveBeenCalled();
      expectClaim(m, testRun, TestStatus.autoApproved);
    });

    it('auto approves a same-branch run by adding the baseline', async () => {
      const testRun = sameBranchRun();
      const { service, m } = await initApproveService(testRun);

      await service.approve(testRun.id, false, true);

      expect(m.tv.addBaseline).toHaveBeenCalledWith(
        { id: mainVariation.id, userId: undefined, testRunId: testRun.id, baselineName: copiedBaselineName },
        expect.anything()
      );
      expectClaim(m, testRun, TestStatus.autoApproved);
    });

    it('re-approving an already approved feature-branch run is a 409 and changes nothing', async () => {
      const testRun = featureRun({ status: TestStatus.approved });
      const { service, m } = await initApproveService(testRun);

      await expect(service.approve(testRun.id)).rejects.toThrow(
        new TestRunAlreadyDecidedException(`Test run ${testRun.id} is already approved`)
      );

      expectNoWrites(m);
      expect(m.tv.update).not.toHaveBeenCalled();
      expect(m.events.testRunUpdated).not.toHaveBeenCalled();
    });

    it('auto approving an already auto approved run is a 409 and changes nothing', async () => {
      const testRun = featureRun({ status: TestStatus.autoApproved });
      const { service, m } = await initApproveService(testRun);

      await expect(service.approve(testRun.id, false, true)).rejects.toThrow(TestRunAlreadyDecidedException);

      expect(m.baseline.count).not.toHaveBeenCalled();
      expect(m.static.copyImage).not.toHaveBeenCalled();
      expect(m.testRun.updateMany).not.toHaveBeenCalled();
    });

    it('manually approving an autoApproved run that already has a baseline is a 409 and changes nothing', async () => {
      const testRun = sameBranchRun({ status: TestStatus.autoApproved });
      const { service, m } = await initApproveService(testRun, { baselineCount: 1 });

      await expect(service.approve(testRun.id)).rejects.toThrow(
        new TestRunAlreadyDecidedException(`Test run ${testRun.id} is already approved`)
      );

      expect(m.baseline.count).toHaveBeenCalledWith({ where: { testRunId: testRun.id } });
      expectNoWrites(m);
    });

    it('manually approving an autoApproved feature-branch run without a baseline approves it', async () => {
      const testRun = featureRun({ status: TestStatus.autoApproved });
      const { service, m } = await initApproveService(testRun, { baselineCount: 0 });
      m.tv.findUnique.mockResolvedValueOnce(null);
      m.tv.create.mockResolvedValueOnce(generateTestVariation({ id: 'feature variation' }));
      m.tv.update.mockResolvedValueOnce(generateTestVariation({ id: 'feature variation' }));

      await service.approve(testRun.id);

      expectClaim(m, testRun, TestStatus.approved);
      expect(m.tv.addBaseline).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'feature variation', baselineName: copiedBaselineName }),
        expect.anything()
      );
    });

    it('a lost claim is a 409, deletes the copy and changes nothing', async () => {
      const testRun = sameBranchRun();
      const { service, m } = await initApproveService(testRun, { updateManyCount: 0 });

      await expect(service.approve(testRun.id)).rejects.toThrow(
        new TestRunAlreadyDecidedException(`Test run ${testRun.id} was changed by someone else meanwhile`)
      );

      expect(m.tv.addBaseline).not.toHaveBeenCalled();
      expect(m.static.deleteImage).toHaveBeenCalledWith(copiedBaselineName);
      expect(m.events.testRunUpdated).not.toHaveBeenCalled();
    });

    it('deletes the copy when the transaction fails', async () => {
      const testRun = sameBranchRun();
      const { service, m } = await initApproveService(testRun);
      m.tv.addBaseline.mockRejectedValueOnce(new Error('db'));

      await expect(service.approve(testRun.id)).rejects.toThrow('db');

      expect(m.static.deleteImage).toHaveBeenCalledWith(copiedBaselineName);
      expect(m.events.testRunUpdated).not.toHaveBeenCalled();
    });

    it('retries once when a concurrent approval created the feature variation', async () => {
      const testRun = featureRun();
      const { service, m } = await initApproveService(testRun);
      m.static.copyImage.mockResolvedValueOnce('copy1.png').mockResolvedValueOnce('copy2.png');
      const winner = generateTestVariation({ id: 'winner', branchName: 'feature' });
      m.tv.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      m.tv.create.mockRejectedValueOnce(prismaError('P2002'));
      m.tv.update.mockResolvedValueOnce(winner);

      const result = await service.approve(testRun.id);

      expect(result).toBe(testRun);
      expect(m.static.deleteImage).toHaveBeenCalledWith('copy1.png');
      expect(m.tv.addBaseline).toHaveBeenCalledTimes(1);
      expect(m.tv.addBaseline).toHaveBeenCalledWith(
        expect.objectContaining({ id: winner.id, baselineName: 'copy2.png' }),
        expect.anything()
      );
    });

    it('rethrows a second P2002', async () => {
      const testRun = featureRun();
      const { service, m } = await initApproveService(testRun);
      m.tv.findUnique.mockResolvedValue(null);
      m.tv.create.mockRejectedValue(prismaError('P2002'));

      await expect(service.approve(testRun.id)).rejects.toMatchObject({ code: 'P2002' });

      expect(m.tv.create).toHaveBeenCalledTimes(2);
      expect(m.tv.addBaseline).not.toHaveBeenCalled();
    });
  });

  describe('auto approval', () => {
    const tryNew = (service: TestRunsService, testRun: TestRun, testVariation = generateTestVariation()) =>
      service['tryAutoApproveByNewBaselines']({ testVariation, testRun, project: TEST_PROJECT });
    const tryPast = (service: TestRunsService, testRun: TestRun, testVariation = generateTestVariation()) =>
      service['tryAutoApproveByPastBaselines']({ testVariation, testRun, project: TEST_PROJECT });
    const imageBytes = Buffer.from('x');

    describe.each([
      [
        'tryAutoApproveByNewBaselines',
        tryNew,
        (m: Mocks) => {
          m.testRun.findMany.mockResolvedValueOnce([{ testVariationId: 'other variation' }]);
          m.tv.findLatestBaselines.mockResolvedValueOnce([generateBaseline()]);
        },
      ],
      [
        'tryAutoApproveByPastBaselines',
        tryPast,
        (m: Mocks) => m.tv.findBaselineHistory.mockResolvedValueOnce([generateBaseline(), generateBaseline()]),
      ],
    ])('%s', (_name, run, arrange) => {
      it('skip if ok', async () => {
        const testRun = generateTestRun({ status: TestStatus.ok });
        const { service } = await build();

        expect(await run(service, testRun)).toBe(testRun);
      });

      it('should not auto approve', async () => {
        const testRun = generateTestRun({ status: TestStatus.unresolved });
        const { service, m } = await build();
        arrange(m);
        service['shouldAutoApprove'] = jest.fn().mockResolvedValueOnce(false);

        const result = await run(service, testRun);

        expect(service['shouldAutoApprove']).toHaveBeenCalled();
        expect(result).toBe(testRun);
      });

      it('should auto approve', async () => {
        const testRun = generateTestRun({ status: TestStatus.unresolved });
        const { service, m } = await build();
        arrange(m);
        service['shouldAutoApprove'] = jest.fn().mockResolvedValueOnce(true);
        service.approve = jest.fn().mockResolvedValueOnce({ ...testRun, status: TestStatus.autoApproved });

        const result = await run(service, testRun);

        expect(result).toStrictEqual({ ...testRun, status: TestStatus.autoApproved });
      });
    });

    it('does not look again once the past baselines approved the run', async () => {
      const testRun = generateTestRun({ status: TestStatus.autoApproved });
      const { service, m } = await build();

      const result = await tryNew(service, testRun);

      expect(m.testRun.findMany).not.toHaveBeenCalled();
      expect(result).toBe(testRun);
    });

    it('skip if the branch the same as baseline', async () => {
      const testRun = generateTestRun({ status: TestStatus.unresolved, branchName: 'a', baselineBranchName: 'a' });
      const { service } = await build();

      expect(await tryPast(service, testRun)).toBe(testRun);
    });

    describe('details', () => {
      it('by past baselines skips the latest baseline and approves on the first older one that matches', async () => {
        const testRun = generateTestRun({ status: TestStatus.unresolved, branchName: 'feature' });
        const testVariation = generateTestVariation({ id: 'variation', projectId: 'project' });
        const { service, m } = await build();
        m.tv.findBaselineHistory.mockResolvedValueOnce(
          ['latest', 'older', 'oldest'].map((name) => generateBaseline({ id: name, baselineName: `${name}.png` }))
        );
        m.compare.getDiff.mockResolvedValueOnce({ status: TestStatus.ok });
        m.static.getImageBuffer.mockResolvedValue(imageBytes);
        const approved = generateTestRun({ status: TestStatus.autoApproved });
        service.approve = jest.fn().mockResolvedValueOnce(approved);

        const result = await tryPast(service, testRun, testVariation);

        expect(m.tv.findBaselineHistory).toHaveBeenCalledWith('variation');
        expect(m.compare.getDiff).toHaveBeenCalledTimes(1);
        expect(diffInputs(m)[0].data.baseline).toBe('older.png');
        expect(service.approve).toHaveBeenCalledWith(testRun.id, false, true);
        expect(result).toBe(approved);
      });

      it('by past baselines has nothing to try with a single baseline', async () => {
        const testRun = generateTestRun({ status: TestStatus.unresolved, branchName: 'feature' });
        const { service, m } = await build();
        m.tv.findBaselineHistory.mockResolvedValueOnce([generateBaseline()]);
        service['shouldAutoApprove'] = jest.fn();

        const result = await tryPast(service, testRun);

        expect(service['shouldAutoApprove']).not.toHaveBeenCalled();
        expect(result).toBe(testRun);
      });

      it('by new baselines looks for approved runs against the same baseline and compares with their latest baseline', async () => {
        const testRun = generateTestRun({ status: TestStatus.unresolved });
        const testVariation = generateTestVariation({ id: 'variation', projectId: 'project', baselineName: 'b.png' });
        const { service, m } = await build();
        m.testRun.findMany.mockResolvedValueOnce([{ testVariationId: 'other variation' }]);
        m.tv.findLatestBaselines.mockResolvedValueOnce([
          generateBaseline({ id: 'latest', baselineName: 'latest.png' }),
        ]);
        m.compare.getDiff.mockResolvedValueOnce({ status: TestStatus.ok });
        m.static.getImageBuffer.mockResolvedValue(imageBytes);
        service.approve = jest.fn().mockResolvedValueOnce(testRun);

        await tryNew(service, testRun, testVariation);

        expect(m.testRun.findMany).toHaveBeenCalledWith({
          where: {
            ...getTestVariationUniqueData(testVariation),
            baselineName: 'b.png',
            status: TestStatus.approved,
            testVariation: { projectId: 'project' },
          },
          select: { testVariationId: true },
        });
        expect(m.tv.findLatestBaselines).toHaveBeenCalledWith(['other variation']);
        expect(diffInputs(m)[0].data.baseline).toBe('latest.png');
        expect(service.approve).toHaveBeenCalledWith(testRun.id, false, true);
      });

      it('by new baselines asks once per variation, however many runs it approved', async () => {
        const { service, m } = await build();
        m.testRun.findMany.mockResolvedValueOnce(
          ['v1', 'v2', 'v1', null].map((testVariationId) => ({ testVariationId }))
        );
        m.tv.findLatestBaselines.mockResolvedValueOnce([]);

        await tryNew(service, generateTestRun({ status: TestStatus.unresolved }));

        expect(m.tv.findLatestBaselines).toHaveBeenCalledWith(['v1', 'v2']);
      });

      it.each([
        ['skips a variation without baselines instead of failing', [{ testVariationId: 'v1' }], ['v1']],
        ['keeps the run when nothing was approved before', [], []],
      ])('by new baselines %s', async (_case, approvedRuns, variationIds) => {
        const testRun = generateTestRun({ status: TestStatus.unresolved });
        const { service, m } = await build();
        m.testRun.findMany.mockResolvedValueOnce(approvedRuns);
        m.tv.findLatestBaselines.mockResolvedValueOnce([]);

        const result = await tryNew(service, testRun);

        expect(m.tv.findLatestBaselines).toHaveBeenCalledWith(variationIds);
        expect(m.compare.getDiff).not.toHaveBeenCalled();
        expect(result).toBe(testRun);
      });
    });

    describe('decides as before', () => {
      const legacyPast = (history: string[], ok: Set<string>) => history.slice(1).some((name) => ok.has(name));
      const legacyNew = (runVariations: string[], newest: Record<string, string>, ok: Set<string>) =>
        runVariations.some((id) => ok.has(newest[id]));

      const testRun = generateTestRun({ status: TestStatus.unresolved, branchName: 'feature' });
      const testVariation = generateTestVariation({ id: 'variation', projectId: 'project' });

      const initWith = async (ok: Set<string>, arrange: (m: Mocks) => void) => {
        const { service, m } = await build();
        arrange(m);
        m.compare.getDiff.mockImplementation(async ({ data }) => ({
          status: ok.has(data.baseline) ? TestStatus.ok : TestStatus.unresolved,
        }));
        m.static.getImageBuffer.mockResolvedValue(Buffer.from('image'));
        service.approve = jest.fn().mockResolvedValue(generateTestRun({ status: TestStatus.autoApproved }));
        return { service, compared: () => diffInputs(m).map(({ data }) => data.baseline as string) };
      };

      it.each<[string, string[], string[]]>([
        ['no history', [], []],
        ['a single baseline that would match', ['a'], ['a']],
        ['an older baseline that matches', ['a', 'b'], ['b']],
        ['a repeated name before a match', ['a', 'b', 'b', 'c'], ['c']],
        ['a repeated name without a match', ['a', 'b', 'b'], []],
        ['the newest name repeated in the past', ['a', 'a'], ['a']],
        ['a match on the newest baseline only', ['a', 'b', 'c'], ['a']],
      ])('by past baselines: %s', async (_name, history, matching) => {
        const ok = new Set(matching);
        const { service, compared } = await initWith(ok, (m) =>
          m.tv.findBaselineHistory.mockResolvedValue(
            history.map((baselineName, i) => generateBaseline({ id: `b${i}`, baselineName }))
          )
        );

        await tryPast(service, testRun, testVariation);

        expect(jest.mocked(service.approve).mock.calls.length > 0).toBe(legacyPast(history, ok));
        expect(new Set(compared()).size).toBe(compared().length);
        expect(compared().length).toBeLessThanOrEqual(new Set(history.slice(1)).size);
      });

      it.each<[string, string[], Record<string, string>, string[]]>([
        ['two runs of one variation, a match on the other', ['v1', 'v1', 'v2'], { v1: 'x', v2: 'y' }, ['y']],
        ['two variations with the same newest baseline, no match', ['v1', 'v2'], { v1: 'x', v2: 'x' }, []],
        ['no approved runs', [], {}, []],
      ])('by new baselines: %s', async (_name, runVariations, newest, matching) => {
        const ok = new Set(matching);
        const { service, compared } = await initWith(ok, (m) => {
          m.testRun.findMany.mockResolvedValue(runVariations.map((testVariationId) => ({ testVariationId })));
          m.tv.findLatestBaselines.mockImplementation(async (ids: string[]) =>
            ids.flatMap((id) => (newest[id] ? [generateBaseline({ id: `b-${id}`, baselineName: newest[id] })] : []))
          );
        });

        await tryNew(service, testRun, testVariation);

        expect(jest.mocked(service.approve).mock.calls.length > 0).toBe(legacyNew(runVariations, newest, ok));
        expect(new Set(compared()).size).toBe(compared().length);
        expect(compared().length).toBeLessThanOrEqual(new Set(runVariations.map((id) => newest[id])).size);
      });
    });
  });

  describe('shouldAutoApprove', () => {
    const testRun = generateTestRun({
      imageName: 'image.png',
      ignoreAreas: JSON.stringify(ignoreAreas),
      diffTollerancePercent: 3,
    });
    const baseline = generateBaseline({ baselineName: 'past.baseline.png' });
    const project = { ...TEST_PROJECT, id: 'projectId' };
    const bytes = Buffer.from('image bytes');

    it('compares the run against the given baseline without saving a diff, and approves an ok result', async () => {
      const { service, m } = await build();
      m.compare.getDiff.mockResolvedValueOnce({ status: TestStatus.ok });

      const result = await service['shouldAutoApprove']({
        project,
        baseline,
        testRun,
        imageBuffer: bytes,
        ignoreAreas,
      });

      expect(m.compare.getDiff).toHaveBeenCalledWith({
        projectId: 'projectId',
        project,
        data: {
          image: 'image.png',
          imageBuffer: bytes,
          baseline: 'past.baseline.png',
          ignoreAreas,
          diffTollerancePercent: 3,
          saveDiffAsFile: false,
        },
      });
      expect(result).toBe(true);
    });

    it('does not approve any other result', async () => {
      const { service, m } = await build();
      m.compare.getDiff.mockResolvedValueOnce({ status: TestStatus.unresolved });

      expect(await service['shouldAutoApprove']({ project, baseline, testRun, ignoreAreas })).toBe(false);
    });
  });

  describe('autoApproveOnFirstMatch', () => {
    const testRun = generateTestRun({
      status: TestStatus.unresolved,
      imageName: 'image.png',
      ignoreAreas: JSON.stringify(ignoreAreas),
      diffTollerancePercent: 3,
    });
    const ref = (baselineName: string) => ({ id: `id of ${baselineName}`, baselineName });
    const refs = (...names: string[]) => names.map(ref);
    const firstMatch = (service: TestRunsService, baselines: ReturnType<typeof refs>, uploaded?: Buffer) =>
      service['autoApproveOnFirstMatch'](TEST_PROJECT, testRun, baselines, uploaded);
    const initFirstMatch = async () => {
      const ctx = await build();
      ctx.m.compare.getDiff.mockResolvedValue({ status: TestStatus.unresolved });
      return ctx;
    };
    const expectBytes = (m: Mocks, times: number, expected: Buffer | undefined) => {
      expect(m.compare.getDiff).toHaveBeenCalledTimes(times);
      diffInputs(m).forEach(({ data }) => expect(data.imageBuffer).toBe(expected));
    };

    it('compares each baseline name once', async () => {
      const { service, m } = await initFirstMatch();
      m.static.getImageBuffer.mockResolvedValue(Buffer.from('x'));

      const result = await firstMatch(service, refs('a', 'b', 'a', 'c'));

      expect(diffInputs(m).map(({ data }) => data.baseline)).toStrictEqual(['a', 'b', 'c']);
      expect(result).toBe(testRun);
    });

    it('reads the run image once for all candidates', async () => {
      const bytes = Buffer.from('image bytes');
      const { service, m } = await initFirstMatch();
      m.static.getImageBuffer.mockResolvedValue(bytes);

      await firstMatch(service, refs('a', 'b', 'c'));

      expect(m.static.getImageBuffer).toHaveBeenCalledTimes(1);
      expect(m.static.getImageBuffer).toHaveBeenCalledWith('image.png');
      expectBytes(m, 3, bytes);
    });

    it('uses the uploaded bytes without reading the storage', async () => {
      const uploaded = Buffer.from('uploaded bytes');
      const { service, m } = await initFirstMatch();

      await firstMatch(service, refs('a', 'b'), uploaded);

      expect(m.static.getImageBuffer).not.toHaveBeenCalled();
      expectBytes(m, 2, uploaded);
    });

    it('lets each comparison read the image when reading it up front fails, and logs why', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const { service, m } = await initFirstMatch();
      m.static.getImageBuffer.mockRejectedValueOnce(new Error('s3'));

      const result = await firstMatch(service, refs('a', 'b'));

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('s3'));
      warn.mockRestore();
      expectBytes(m, 2, undefined);
      expect(result).toBe(testRun);
    });

    it('lets each comparison read the image when the storage has none', async () => {
      const { service, m } = await initFirstMatch();
      m.static.getImageBuffer.mockResolvedValue(null);

      await firstMatch(service, refs('a'));

      expect(diffInputs(m)[0].data.imageBuffer).toBeUndefined();
    });

    it('reads nothing without candidates', async () => {
      const { service, m } = await build();

      const result = await firstMatch(service, []);

      expect(m.static.getImageBuffer).not.toHaveBeenCalled();
      expect(m.compare.getDiff).not.toHaveBeenCalled();
      expect(result).toBe(testRun);
    });

    it('stops at the first match and approves', async () => {
      const { service, m } = await build();
      m.compare.getDiff.mockImplementation(async ({ data }) => ({
        status: data.baseline === 'b' ? TestStatus.ok : TestStatus.unresolved,
      }));
      m.static.getImageBuffer.mockResolvedValue(Buffer.from('x'));
      const approved = generateTestRun({ status: TestStatus.autoApproved });
      service.approve = jest.fn().mockResolvedValueOnce(approved);

      const result = await firstMatch(service, refs('a', 'b', 'c'));

      expect(m.compare.getDiff).toHaveBeenCalledTimes(2);
      expect(service.approve).toHaveBeenCalledWith(testRun.id, false, true);
      expect(result).toBe(approved);
    });

    it('returns the run as it is now when someone decided it meanwhile', async () => {
      const { service, m } = await build();
      m.compare.getDiff.mockResolvedValue({ status: TestStatus.ok });
      service.approve = jest.fn().mockRejectedValueOnce(new TestRunAlreadyDecidedException('decided'));
      const current = generateTestRun({ status: TestStatus.approved });
      m.testRun.findUnique.mockResolvedValueOnce(current);

      expect(await firstMatch(service, refs('a'))).toBe(current);
    });
  });
});
