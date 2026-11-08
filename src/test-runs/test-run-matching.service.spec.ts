import { Test } from '@nestjs/testing';
import { TestRunDto } from './dto/testRun.dto';
import { TestRun, TestStatus } from '@prisma/client';
import { SIGNATURE_CONCURRENCY, TestRunMatchingService } from './test-run-matching.service';
import { SIGNATURE_LENGTH } from '../compare/libs/pixelmatch/signature.core';
import { PrismaService } from '../prisma/prisma.service';
import { StaticService } from '../static/static.service';
import { CompareService } from '../compare/compare.service';
import { generateTestRun } from '../_data_';

const createMocks = () => ({
  testRun: { findMany: jest.fn() },
  project: { findUnique: jest.fn() },
  static: { getImageBuffer: jest.fn() },
  compare: {
    getChangeSignature: jest.fn(),
    getSignatureConfig: jest.fn().mockReturnValue({ threshold: 0.1, includeAA: true }),
  },
});

const build = async () => {
  const m = createMocks();
  const module = await Test.createTestingModule({
    providers: [
      TestRunMatchingService,
      { provide: PrismaService, useValue: { testRun: m.testRun, project: m.project } },
      { provide: StaticService, useValue: m.static },
      { provide: CompareService, useValue: m.compare },
    ],
  }).compile();
  return { service: module.get<TestRunMatchingService>(TestRunMatchingService), m };
};

describe('TestRunMatchingService', () => {
  describe('getMatchingVariations', () => {
    const ignoreAreas = [{ x: 1, y: 2, width: 10, height: 20 }];
    const histogram = (hot: number): number[] =>
      Array.from({ length: SIGNATURE_LENGTH }, (_unused, index) => (index === hot ? 1 : 0));
    const SAME_PALETTE = histogram(0);
    const OTHER_PALETTE = histogram(SIGNATURE_LENGTH - 1);

    const sibling = (id: string, overrides: Partial<TestRun> = {}): TestRun =>
      generateTestRun({
        id,
        status: TestStatus.unresolved,
        name: 'Screen A',
        baselineName: `${id}.baseline.png`,
        imageName: `${id}.screenshot.png`,
        customTags: id,
        diffPercent: 12,
        ...overrides,
      });
    const target = (overrides: Partial<TestRun> = {}) => sibling('target', { customTags: '', ...overrides });
    const stamped = (signature: unknown[], stamp = { threshold: 0.1, includeAA: true }) =>
      JSON.stringify({ ...stamp, signature });

    type Result = Awaited<ReturnType<TestRunMatchingService['getMatchingVariations']>>;
    const variationIds = (result: Result) => result.variations.map((variation) => variation.id);
    const skippedReasons = (result: Result) => result.skipped.map((item) => item.reason);
    const skippedPairs = (result: Result) => result.skipped.map((item) => [item.id, item.reason]);

    const initMatching = async ({
      testRun,
      siblings = [],
      project = { bulkApproveVariations: true, bulkApproveGroupBy: 'customTags', imageComparisonConfig: null },
      signatureOf = () => SAME_PALETTE,
      imageBufferOf = async (name: string) => Buffer.from(name),
    }: {
      testRun: TestRun;
      siblings?: TestRun[];
      project?: object | null;
      signatureOf?: (imageName: string) => Promise<number[] | null> | number[] | null;
      imageBufferOf?: (name: string) => Promise<Buffer | null>;
    }) => {
      const { service, m } = await build();
      m.compare.getChangeSignature.mockImplementation(async (input) => ({
        signature: await signatureOf(input.image.toString()),
      }));
      m.testRun.findMany.mockResolvedValue(siblings);
      m.project.findUnique.mockResolvedValue(project);
      m.static.getImageBuffer.mockImplementation(imageBufferOf);
      return {
        service,
        m,
        matches: () => service.getMatchingVariations(testRun),
        signed: () => m.compare.getChangeSignature.mock.calls.map(([input]) => input.image.toString()),
      };
    };

    const trackConcurrency = () => {
      let inFlight = 0;
      let peak = 0;
      return {
        peak: () => peak,
        signatureOf: async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 0));
          inFlight -= 1;
          return SAME_PALETTE;
        },
      };
    };

    it('matches same-palette, same-size siblings and skips different pattern / far larger change', async () => {
      const testRun = target();
      const matching = sibling('locale-a');
      const bigger = sibling('locale-b', { diffPercent: 30 });
      const different = sibling('locale-c');
      const { matches } = await initMatching({
        testRun,
        siblings: [matching, bigger, different],
        signatureOf: (imageName) => (imageName.startsWith('locale-c') ? OTHER_PALETTE : SAME_PALETTE),
      });

      const result = await matches();

      expect(variationIds(result)).toEqual([testRun.id, matching.id]);
      expect(result.skipped.map((item) => ({ id: item.id, reason: item.reason }))).toEqual([
        { id: bigger.id, reason: 'different change size' },
        { id: different.id, reason: 'different change pattern' },
      ]);
    });

    it('groups from the signatures stored at ingest, without decoding anything', async () => {
      const signed = (id: string, signature: number[], overrides = {}) =>
        sibling(id, { changeSignature: stamped(signature), ...overrides });
      const testRun = signed('target', SAME_PALETTE, { customTags: '' });
      const matching = signed('locale-a', SAME_PALETTE);
      const different = signed('locale-c', OTHER_PALETTE);
      const ctx = await initMatching({
        testRun,
        siblings: [matching, different],
        signatureOf: () => {
          throw new Error('should not be computing a signature');
        },
      });

      const result = await ctx.matches();

      expect(ctx.m.compare.getChangeSignature).not.toHaveBeenCalled();
      expect(variationIds(result)).toEqual([testRun.id, matching.id]);
      expect(skippedReasons(result)).toEqual(['different change pattern']);
    });

    it('recomputes when the project config has moved on since ingest', async () => {
      const stale = stamped(SAME_PALETTE, { threshold: 0.9, includeAA: false });
      const testRun = target({ changeSignature: stale });
      const matching = sibling('locale-a', { changeSignature: stale });
      const ctx = await initMatching({ testRun, siblings: [matching] });

      const result = await ctx.matches();

      expect(ctx.signed().sort()).toEqual([testRun.imageName, matching.imageName].sort());
      expect(variationIds(result)).toEqual([testRun.id, matching.id]);
    });

    it('falls back to computing for a run with nothing stored', async () => {
      const testRun = target({ changeSignature: stamped(SAME_PALETTE) });
      const unsigned = sibling('locale-a');
      const ctx = await initMatching({ testRun, siblings: [unsigned] });

      const result = await ctx.matches();

      expect(ctx.signed()).toEqual([unsigned.imageName]);
      expect(variationIds(result)).toEqual([testRun.id, unsigned.id]);
    });

    it('skips a far larger change without paying for its signature', async () => {
      const testRun = target();
      const ctx = await initMatching({ testRun, siblings: [sibling('locale-b', { diffPercent: 30 })] });

      await ctx.matches();

      expect(ctx.signed()).toEqual([testRun.imageName]);
    });

    it('says a sibling has no diff rather than blaming its change size', async () => {
      const ctx = await initMatching({ testRun: target(), siblings: [sibling('locale-b', { diffPercent: 0 })] });

      expect(skippedReasons(await ctx.matches())).toEqual(['no diff to match']);
    });

    it('asks for the siblings signatures at once rather than one after another', async () => {
      const siblings = ['locale-a', 'locale-b', 'locale-c'].map((id) => sibling(id));
      const tracked = trackConcurrency();
      const ctx = await initMatching({ testRun: target(), siblings, signatureOf: tracked.signatureOf });

      await ctx.matches();

      expect(tracked.peak()).toBe(siblings.length + 1);
    });

    it('keeps the number of images being decoded at once bounded', async () => {
      const siblings = Array.from({ length: SIGNATURE_CONCURRENCY * 3 }, (_, index) => sibling(`locale-${index}`));
      const tracked = trackConcurrency();
      const ctx = await initMatching({ testRun: target(), siblings, signatureOf: tracked.signatureOf });

      await ctx.matches();

      expect(tracked.peak()).toBe(SIGNATURE_CONCURRENCY);
    });

    it('reuses the signatures it already computed when the dialog is reopened', async () => {
      const testRun = target();
      const matching = sibling('locale-a');
      const ctx = await initMatching({ testRun, siblings: [matching] });

      await ctx.matches();
      const afterFirst = ctx.m.compare.getChangeSignature.mock.calls.length;
      const second = await ctx.matches();

      expect(afterFirst).toBe(2);
      expect(ctx.m.compare.getChangeSignature).toHaveBeenCalledTimes(2);
      expect(variationIds(second)).toEqual([testRun.id, matching.id]);
    });

    it('recomputes a signature once the run gained an ignore area', async () => {
      const matching = sibling('locale-a');
      const ctx = await initMatching({ testRun: target(), siblings: [matching] });

      await ctx.matches();
      matching.ignoreAreas = JSON.stringify([{ x: 0, y: 0, width: 10, height: 10 }]);
      await ctx.matches();

      expect(ctx.m.compare.getChangeSignature).toHaveBeenCalledTimes(3);
    });

    it('returns only the run itself when the run has no project', async () => {
      const testRun = sibling('target', { projectId: null });
      const ctx = await initMatching({ testRun });

      const result = await ctx.matches();

      expect(ctx.m.project.findUnique).not.toHaveBeenCalled();
      expect(ctx.m.testRun.findMany).not.toHaveBeenCalled();
      expect(result).toEqual({ variations: [new TestRunDto(testRun)], skipped: [] });
    });

    it('returns only the run itself when the project has bulk approval turned off', async () => {
      const testRun = sibling('target');
      const ctx = await initMatching({ testRun, project: { bulkApproveVariations: false } });

      const result = await ctx.matches();

      expect(ctx.m.project.findUnique).toHaveBeenCalledWith({ where: { id: testRun.projectId } });
      expect(ctx.m.testRun.findMany).not.toHaveBeenCalled();
      expect(result).toEqual({ variations: [new TestRunDto(testRun)], skipped: [] });
    });

    it('looks for unresolved and new siblings that differ only in customTags by default', async () => {
      const testRun = sibling('target', { os: 'linux', device: null, browser: 'chrome', viewport: '800x600' });
      const ctx = await initMatching({ testRun });

      await ctx.matches();

      expect(ctx.m.testRun.findMany).toHaveBeenCalledWith({
        where: {
          id: { not: testRun.id },
          buildId: testRun.buildId,
          branchName: testRun.branchName,
          name: testRun.name,
          os: 'linux',
          device: null,
          browser: 'chrome',
          viewport: '800x600',
          status: { in: [TestStatus.unresolved, TestStatus.new] },
        },
      });
    });

    it.each([
      ['os', { customTags: 'target', device: null, browser: 'chromium', viewport: '1800x1600' }],
      ['viewport', { customTags: 'target', os: null, device: null, browser: 'chromium' }],
      ['an unknown axis', { os: null, device: null, browser: 'chromium', viewport: '1800x1600' }],
    ])('groups across %s when the project says so', async (groupBy, fixedAxes) => {
      const ctx = await initMatching({
        testRun: sibling('target'),
        project: {
          bulkApproveVariations: true,
          bulkApproveGroupBy: groupBy === 'an unknown axis' ? 'locale' : groupBy,
        },
      });

      await ctx.matches();

      const { where } = ctx.m.testRun.findMany.mock.calls[0][0];
      const axes = ['customTags', 'os', 'device', 'browser', 'viewport'].filter((axis) => axis in where);
      expect(Object.fromEntries(axes.map((axis) => [axis, where[axis]]))).toEqual(fixedAxes);
    });

    it('signs with the threshold and anti-aliasing setting the compare service reads from the project', async () => {
      const testRun = sibling('target', { ignoreAreas: JSON.stringify(ignoreAreas) });
      const project = { bulkApproveVariations: true, imageComparisonConfig: '{ "threshold": 0.3 }' };
      const ctx = await initMatching({ testRun, project });
      ctx.m.compare.getSignatureConfig.mockReturnValue({ threshold: 0.3, includeAA: false });

      await ctx.matches();

      expect(ctx.m.compare.getSignatureConfig).toHaveBeenCalledWith(project);
      expect(ctx.m.compare.getChangeSignature).toHaveBeenCalledWith({
        baseline: Buffer.from(testRun.baselineName!),
        image: Buffer.from(testRun.imageName),
        ignoreAreas,
        threshold: 0.3,
        includeAA: false,
      });
    });

    it('sends every sibling to manual review when the reviewed run has no baseline to compare', async () => {
      const testRun = sibling('target', { baselineName: null });
      const unchanged = sibling('locale-a', { diffPercent: 0 });
      const candidate = sibling('locale-b');
      const ctx = await initMatching({ testRun, siblings: [unchanged, candidate] });

      const result = await ctx.matches();

      expect(variationIds(result)).toEqual([testRun.id]);
      expect(skippedPairs(result)).toEqual([
        [unchanged.id, 'no reference diff'],
        [candidate.id, 'no reference diff'],
      ]);
      expect(ctx.signed()).toEqual([candidate.imageName]);
    });

    it('treats a missing screenshot as no reference diff', async () => {
      const ctx = await initMatching({
        testRun: sibling('target'),
        siblings: [sibling('locale-a')],
        imageBufferOf: async () => null,
      });

      const result = await ctx.matches();

      expect(ctx.m.compare.getChangeSignature).not.toHaveBeenCalled();
      expect(skippedReasons(result)).toEqual(['no reference diff']);
    });

    it('skips a sibling that has nothing to compare with no diff to match', async () => {
      const testRun = sibling('target');
      const noBaseline = sibling('locale-a', { baselineName: null });
      const noSignature = sibling('locale-b');
      const matching = sibling('locale-c');
      const ctx = await initMatching({
        testRun,
        siblings: [noBaseline, noSignature, matching],
        signatureOf: (imageName) => (imageName.startsWith('locale-b') ? null : SAME_PALETTE),
      });

      const result = await ctx.matches();

      expect(variationIds(result)).toEqual([testRun.id, matching.id]);
      expect(skippedPairs(result)).toEqual([
        [noBaseline.id, 'no diff to match'],
        [noSignature.id, 'no diff to match'],
      ]);
    });

    it('lists skipped siblings in the order they were found, whichever check skipped them', async () => {
      const otherPattern = sibling('locale-a');
      const unchanged = sibling('locale-b', { diffPercent: 0 });
      const bigger = sibling('locale-c', { diffPercent: 100 });
      const ctx = await initMatching({
        testRun: sibling('target'),
        siblings: [otherPattern, unchanged, bigger],
        signatureOf: (imageName) => (imageName.startsWith('locale-a') ? OTHER_PALETTE : SAME_PALETTE),
      });

      const result = await ctx.matches();

      expect(skippedPairs(result)).toEqual([
        [otherPattern.id, 'different change pattern'],
        [unchanged.id, 'no diff to match'],
        [bigger.id, 'different change size'],
      ]);
      expect(result.skipped[0]).toEqual({ ...new TestRunDto(otherPattern), reason: 'different change pattern' });
    });

    it.each([
      [12, 24, 'matches'],
      [12, 6, 'matches'],
      [12, 24.5, 'different change size'],
      [12, 5.9, 'different change size'],
      [0, 12, 'different change size'],
      [null, 12, 'different change size'],
    ])('with the reviewed change at %p%% a sibling at %p%% %s', async (reference, size, outcome) => {
      const testRun = sibling('target', { diffPercent: reference });
      const other = sibling('locale-a', { diffPercent: size });
      const ctx = await initMatching({ testRun, siblings: [other] });

      const result = await ctx.matches();

      if (outcome === 'matches') {
        expect(variationIds(result)).toEqual([testRun.id, other.id]);
      } else {
        expect(skippedReasons(result)).toEqual([outcome]);
      }
    });

    it('recomputes and warns when the stored signature cannot be read', async () => {
      const ctx = await initMatching({ testRun: sibling('target', { changeSignature: '{not json' }) });
      const warn = jest.spyOn(ctx.service['logger'], 'warn').mockImplementation(() => undefined);

      await ctx.matches();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Ignoring unreadable stored change signature'));
      expect(ctx.m.compare.getChangeSignature).toHaveBeenCalledTimes(1);
    });

    it('reuses a stored signature stamped with the current config', async () => {
      const ctx = await initMatching({ testRun: sibling('target', { changeSignature: stamped(SAME_PALETTE) }) });

      await ctx.matches();

      expect(ctx.m.compare.getChangeSignature).not.toHaveBeenCalled();
    });

    it.each([
      ['only the threshold changed', stamped(SAME_PALETTE, { threshold: 0.2, includeAA: true })],
      ['only the antialiasing setting changed', stamped(SAME_PALETTE, { threshold: 0.1, includeAA: false })],
      ['the wrong length', stamped([1, 0])],
      ['values that are not numbers', stamped(new Array(SIGNATURE_LENGTH).fill('nope'))],
      ['a single value that is not a number', stamped([1, ...new Array(SIGNATURE_LENGTH - 1).fill('nope')])],
      ['a value that is not finite', stamped(SAME_PALETTE).replace('[1,', '[1e999,')],
    ])('recomputes a stored signature when %s', async (_case, changeSignature) => {
      const ctx = await initMatching({ testRun: sibling('target', { changeSignature }) });

      await ctx.matches();

      expect(ctx.m.compare.getChangeSignature).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['no stored signature', null],
      ['an empty stored signature', ''],
      ['a stored json null', 'null'],
    ])('computes quietly for %s', async (_case, changeSignature) => {
      const ctx = await initMatching({ testRun: sibling('target', { changeSignature }) });
      const warn = jest.spyOn(ctx.service['logger'], 'warn').mockImplementation(() => undefined);

      await ctx.matches();

      expect(warn).not.toHaveBeenCalled();
      expect(ctx.m.compare.getChangeSignature).toHaveBeenCalledTimes(1);
    });

    it('does not remember a failed signature', async () => {
      const testRun = sibling('target');
      let calls = 0;
      const ctx = await initMatching({
        testRun,
        signatureOf: () => {
          calls += 1;
          if (calls === 1) {
            throw new Error('worker crashed');
          }
          return SAME_PALETTE;
        },
      });

      await expect(ctx.matches()).rejects.toThrow('worker crashed');
      const result = await ctx.matches();

      expect(ctx.m.compare.getChangeSignature).toHaveBeenCalledTimes(2);
      expect(variationIds(result)).toEqual([testRun.id]);
    });
  });

  describe('signature cache', () => {
    const filledCache = async (size = 2000) => {
      const { service } = await build();
      const cache = service['signatureCache'];
      for (let index = 0; index < size; index++) {
        cache.set(`key ${index}`, Promise.resolve([index]));
      }
      return cache;
    };

    it('forgets the oldest entry once it holds more than 2000', async () => {
      const cache = await filledCache(2001);

      expect(cache.get('key 0')).toBeUndefined();
      expect(cache.get('key 1')).toBeDefined();
      expect(cache.get('key 2000')).toBeDefined();
    });

    it('does not take up room for a key that was looked up but never set', async () => {
      const cache = await filledCache();

      expect(cache.get('absent')).toBeUndefined();
      cache.set('key 0', Promise.resolve([0]));

      expect(cache.get('key 1')).toBeDefined();
    });

    it('keeps an entry that was read recently', async () => {
      const cache = await filledCache();

      void cache.get('key 0');
      cache.set('one more', Promise.resolve([]));

      expect(cache.get('key 0')).toBeDefined();
      expect(cache.get('key 1')).toBeUndefined();
    });

    it('moves a re-set entry to the back', async () => {
      const cache = await filledCache();

      const replacement = Promise.resolve([42]);
      cache.set('key 0', replacement);
      cache.set('one more', Promise.resolve([]));

      expect(cache.get('key 0')).toBe(replacement);
      expect(cache.get('key 1')).toBeUndefined();
    });
  });
});
