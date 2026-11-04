import { Logger } from '@nestjs/common';
import { ImageComparison, Prisma, TestRun, TestStatus } from '@prisma/client';
import { generateTestRun, TEST_PROJECT } from '../../_data_';
import { DiffWorkerPool } from '../diff-worker-pool';
import { Dinov2Service, PatchDistances } from '../libs/dinov2/dinov2.service';
import { BlurAmplitudeJobOutput, MAX_MEASURED_PIXELS } from '../libs/pixelmatch/blur-amplitude.core';
import { PatchGate } from '../libs/pixelmatch/patch-gate.core';
import { pngBytes, solidPng } from '../test-utils';
import { EventsGateway } from '../../shared/events/events.gateway';
import { PrismaService } from '../../prisma/prisma.service';
import { StaticService } from '../../static/static.service';
import { DEFAULT_NOISE_ANALYSIS_CONFIG, NoiseAnalysisConfig } from './noise-analysis.config';
import { NoiseAnalysisResult } from './noise-analysis.types';
import { NoiseHintService } from './noise-hint.service';

const BASELINE = pngBytes(solidPng(32, 32));
const IMAGE = pngBytes(solidPng(32, 32, [250, 250, 250]));

const headerOnlyPng = (width: number, height: number): Buffer => {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
};

const config = (patch: Partial<NoiseAnalysisConfig> = {}): NoiseAnalysisConfig => ({
  ...DEFAULT_NOISE_ANALYSIS_CONFIG,
  ...patch,
});

const GATE: PatchGate = { width: 4, height: 4, cells: [0, 5, 10] };

const noiseOutput = (patch: Partial<BlurAmplitudeJobOutput> = {}): BlurAmplitudeJobOutput => ({
  measure: { amplitude: 40, solidPixels: 0, solidShare: 0 },
  density: 11,
  densest: [{ x: 8, y: 8, width: 8, height: 8, weight: 11 }],
  gate: GATE,
  ...patch,
});

const changeOutput = (): BlurAmplitudeJobOutput => ({
  measure: { amplitude: 120, solidPixels: 0, solidShare: 0 },
  density: 30,
  densest: [{ x: 0, y: 0, width: 8, height: 8, weight: 30 }],
});

const distances = (values: Record<number, number>, size = 16): PatchDistances => ({
  distances: Array.from({ length: size }, (_, i) => values[i] ?? 0),
  width: 4,
  height: 4,
});

const settled = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(done()).toBe(true);
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const PENDING = { pending: true, requestedAt: '2026-11-04T10:00:00.000Z' };

type StoredRun = TestRun & { project: typeof TEST_PROJECT | null };

const storedRun = (id: string, patch: Partial<StoredRun> = {}): StoredRun => ({
  ...generateTestRun({ id, status: TestStatus.unresolved, diffName: 'diff.png', projectId: TEST_PROJECT.id }),
  project: TEST_PROJECT,
  ...patch,
});

interface Where {
  id: string | { in: string[] };
  status?: TestStatus;
  noiseAnalysis?: { path: string[]; equals: string };
}

const asJson = (value: unknown) => (value === Prisma.DbNull ? null : value);

const build = () => {
  const store = new Map<string, StoredRun>();
  const matching = (where: Where): StoredRun[] =>
    (typeof where.id === 'string' ? [where.id] : where.id.in)
      .flatMap((id) => (store.has(id) ? [store.get(id) as StoredRun] : []))
      .filter((run) => !where.status || run.status === where.status)
      .filter(
        (run) =>
          !where.noiseAnalysis ||
          (run.noiseAnalysis as { requestedAt?: string } | null)?.requestedAt === where.noiseAnalysis.equals
      );
  const prisma = {
    testRun: {
      findMany: jest.fn(({ where }: { where: Where }) => Promise.resolve(matching(where))),
      findUnique: jest.fn(({ where }: { where: { id: string } }): Promise<unknown> =>
        Promise.resolve(store.get(where.id) ?? null)
      ),
      updateMany: jest.fn(({ where, data }: { where: Where; data: { noiseAnalysis: unknown } }) => {
        const runs = matching(where);
        runs.forEach((run) => store.set(run.id, { ...run, noiseAnalysis: asJson(data.noiseAnalysis) as never }));
        return Promise.resolve({ count: runs.length });
      }),
      update: jest.fn(({ where, data }: { where: { id: string }; data: { noiseAnalysis: unknown } }) => {
        const run = { ...(store.get(where.id) as StoredRun), noiseAnalysis: asJson(data.noiseAnalysis) as never };
        store.set(where.id, run);
        return Promise.resolve(run);
      }),
    },
  };
  const staticService = {
    getImageBuffer: jest.fn((name: string | null): Promise<Buffer | null> =>
      Promise.resolve(name === 'baseline.png' ? BASELINE : IMAGE)
    ),
  };
  const pool = { run: jest.fn().mockResolvedValue(noiseOutput()) };
  const dinov2 = {
    isConfigured: jest.fn().mockReturnValue(true),
    patchDistances: jest.fn().mockResolvedValue(distances({ 0: 0.05 })),
  };
  const events = { testRunUpdated: jest.fn() };
  const service = new NoiseHintService(
    prisma as unknown as PrismaService,
    staticService as unknown as StaticService,
    pool as unknown as DiffWorkerPool,
    dinov2 as unknown as Dinov2Service,
    events as unknown as EventsGateway
  );
  const add = (id: string, patch: Partial<StoredRun> = {}) => {
    store.set(id, storedRun(id, patch));
  };
  return { service, prisma, staticService, pool, dinov2, events, store, add };
};

const analysedRun = (patch: Partial<TestRun> = {}): TestRun =>
  generateTestRun({ diffName: 'diff.png', baselineName: 'baseline.png', imageName: 'image.png', ...patch });

describe('NoiseHintService.analyse', () => {
  it('stores the thresholds it measured with, not the enabled flags', async () => {
    const { service } = build();

    const result = await service.analyse(analysedRun(), config());

    expect(result.config).toEqual({
      blur: { amplitudeThreshold: 80, solidShareMax: 0.01 },
      dinov2: { distanceThreshold: 0.15 },
    });
    expect(result.version).toBe(1);
    expect(new Date(result.computedAt).toISOString()).toBe(result.computedAt);
  });

  it('gives the worker the thresholds and the ignore areas of the run', async () => {
    const { service, pool } = build();
    const run = analysedRun({
      ignoreAreas: JSON.stringify([{ x: 1, y: 2, width: 3, height: 4 }]),
      tempIgnoreAreas: JSON.stringify([{ x: 5, y: 6, width: 7, height: 8 }]),
    });

    await service.analyse(run, config());

    expect(pool.run).toHaveBeenCalledWith({
      kind: 'blur-amplitude',
      baseline: BASELINE,
      image: IMAGE,
      ignoreAreas: [
        { x: 1, y: 2, width: 3, height: 4 },
        { x: 5, y: 6, width: 7, height: 8 },
      ],
      thresholds: { amplitudeThreshold: 80, solidShareMax: 0.01 },
    });
  });

  describe('unknown', () => {
    const expectUnknown = (result: NoiseAnalysisResult, reason: string) => {
      expect(result).toMatchObject({ verdict: 'unknown', score: null, reason, blur: null, dinov2: null, version: 1 });
    };

    it('says "sizes differ" without calling the worker when the pair has different dimensions', async () => {
      const { service, pool, staticService } = build();
      staticService.getImageBuffer.mockImplementation((name: string | null) =>
        Promise.resolve(name === 'baseline.png' ? BASELINE : pngBytes(solidPng(40, 32)))
      );

      expectUnknown(await service.analyse(analysedRun({ diffName: null }), config()), 'sizes differ');
      expect(pool.run).not.toHaveBeenCalled();
    });

    it('says "no diff" without calling the worker when the run has no diff image', async () => {
      const { service, pool } = build();

      expectUnknown(await service.analyse(analysedRun({ diffName: null }), config()), 'no diff');
      expect(pool.run).not.toHaveBeenCalled();
    });

    it('says "no diff" when the run has no baseline to compare with', async () => {
      const { service, pool, staticService } = build();
      staticService.getImageBuffer.mockResolvedValueOnce(null);

      expectUnknown(await service.analyse(analysedRun({ baselineName: null }), config()), 'no diff');
      expect(pool.run).not.toHaveBeenCalled();
    });

    it('says "image too large" without calling the worker above the measured pixel limit', async () => {
      const { service, pool, staticService } = build();
      const side = Math.ceil(Math.sqrt(MAX_MEASURED_PIXELS)) + 1;
      staticService.getImageBuffer.mockResolvedValue(headerOnlyPng(side, side));

      expectUnknown(await service.analyse(analysedRun(), config()), 'image too large');
      expect(pool.run).not.toHaveBeenCalled();
    });

    it('measures an image of exactly the pixel limit', async () => {
      const { service, pool, staticService } = build();
      staticService.getImageBuffer.mockResolvedValue(headerOnlyPng(4000, MAX_MEASURED_PIXELS / 4000));

      await service.analyse(analysedRun(), config());

      expect(pool.run).toHaveBeenCalled();
    });

    it('says "image too large" when the worker could not measure the pair', async () => {
      const { service, pool } = build();
      pool.run.mockResolvedValue({ measure: null, density: 0, densest: [] });

      expectUnknown(await service.analyse(analysedRun(), config()), 'image too large');
    });

    it('lets the worker try images whose header cannot be read', async () => {
      const { service, pool, staticService } = build();
      staticService.getImageBuffer.mockResolvedValue(Buffer.from('not a png'));

      await service.analyse(analysedRun(), config());

      expect(pool.run).toHaveBeenCalled();
    });
  });

  describe('blur stage', () => {
    it('scores noise by how close the amplitude is to the threshold', async () => {
      const { service, pool, dinov2 } = build();
      pool.run.mockResolvedValue(noiseOutput());
      dinov2.patchDistances.mockResolvedValue(null);

      const result = await service.analyse(analysedRun(), config());

      expect(result.blur).toEqual({
        verdict: 'noise',
        score: 0.5,
        signals: { amplitude: 40, solidShare: 0, density: 11 },
        regions: [{ x: 8, y: 8, width: 8, height: 8, weight: 11 }],
      });
    });

    it('calls a change when the amplitude is above the threshold, scored 1, and skips DINOv2', async () => {
      const { service, pool, dinov2 } = build();
      pool.run.mockResolvedValue(changeOutput());

      const result = await service.analyse(analysedRun(), config());

      expect(result).toMatchObject({ verdict: 'change', score: 1, reason: null });
      expect(result.blur).toMatchObject({ verdict: 'change', score: 1, signals: { amplitude: 120, density: 30 } });
      expect(result.dinov2).toEqual({ skipped: 'blur sees a change' });
      expect(dinov2.patchDistances).not.toHaveBeenCalled();
    });

    it('calls a change when solid pixels exceed the share limit', async () => {
      const { service, pool } = build();
      pool.run.mockResolvedValue({
        measure: { amplitude: 10, solidPixels: 100, solidShare: 0.5 },
        density: 4,
        densest: [],
      });

      const result = await service.analyse(analysedRun(), config());

      expect(result).toMatchObject({ verdict: 'change', score: 1 });
    });

    it('skips DINOv2 as "off" when the project switched it off', async () => {
      const { service, dinov2 } = build();

      const result = await service.analyse(
        analysedRun(),
        config({ dinov2: { enabled: false, distanceThreshold: 0.15 } })
      );

      expect(result.dinov2).toEqual({ skipped: 'off' });
      expect(result).toMatchObject({ verdict: 'noise', score: 0.5 });
      expect(dinov2.patchDistances).not.toHaveBeenCalled();
    });

    it('skips DINOv2 as "off" when DINOV2_URL is not set', async () => {
      const { service, dinov2 } = build();
      dinov2.isConfigured.mockReturnValue(false);

      const result = await service.analyse(analysedRun(), config());

      expect(result.dinov2).toEqual({ skipped: 'off' });
      expect(dinov2.patchDistances).not.toHaveBeenCalled();
    });

    it('fails loudly when the worker takes a pair for noise but returns no gate', async () => {
      const { service, pool } = build();
      pool.run.mockResolvedValue(noiseOutput({ gate: undefined }));

      await expect(service.analyse(analysedRun(), config())).rejects.toThrow('no patch gate');
    });
  });

  describe('DINOv2 stage', () => {
    it('asks DINOv2 about the gate of the blur job and the two images', async () => {
      const { service, dinov2 } = build();

      await service.analyse(analysedRun(), config());

      expect(dinov2.patchDistances).toHaveBeenCalledWith(GATE, BASELINE, IMAGE);
    });

    it('turns the verdict to change when the strongest patch is above the threshold', async () => {
      const { service, dinov2 } = build();
      dinov2.patchDistances.mockResolvedValue(distances({ 0: 0.05, 5: 0.23, 10: 0.1, 7: 0.9 }));

      const result = await service.analyse(analysedRun(), config());

      expect(result.dinov2).toMatchObject({
        verdict: 'change',
        score: 0.23 / 0.3,
        signals: { distance: 0.23, patches: 3 },
      });
      expect(result.verdict).toBe('change');
      expect(result.score).toBeCloseTo(0.23 / 0.3);
    });

    it('keeps the blur score when it is higher than the DINOv2 one', async () => {
      const { service, pool, dinov2 } = build();
      pool.run.mockResolvedValue(noiseOutput({ measure: { amplitude: 78, solidPixels: 0, solidShare: 0 } }));
      dinov2.patchDistances.mockResolvedValue(distances({ 0: 0.03 }));

      const result = await service.analyse(analysedRun(), config());

      expect(result.score).toBeCloseTo(78 / 80);
      expect(result.dinov2).toMatchObject({ score: 78 / 80 });
    });

    it('caps the score at 1 for a distance beyond twice the threshold', async () => {
      const { service, dinov2 } = build();
      dinov2.patchDistances.mockResolvedValue(distances({ 5: 0.9 }));

      const result = await service.analyse(analysedRun(), config());

      expect(result.score).toBe(1);
    });

    it('stays noise at a distance equal to the threshold', async () => {
      const { service, dinov2 } = build();
      dinov2.patchDistances.mockResolvedValue(distances({ 5: 0.15 }));

      const result = await service.analyse(analysedRun(), config());

      expect(result).toMatchObject({ verdict: 'noise', dinov2: { verdict: 'noise' } });
    });

    it('lists the marked patches above half the threshold, strongest first, in pixel coordinates', async () => {
      const { service, dinov2 } = build();
      dinov2.patchDistances.mockResolvedValue(distances({ 0: 0.08, 5: 0.12, 10: 0.07, 7: 0.9 }));

      const result = await service.analyse(analysedRun(), config());

      expect(result.dinov2).toMatchObject({
        regions: [
          { x: 14, y: 14, width: 14, height: 14, weight: 0.12 },
          { x: 0, y: 0, width: 14, height: 14, weight: 0.08 },
        ],
      });
    });

    it('lists at most 10 regions', async () => {
      const { service, pool, dinov2 } = build();
      const cells = Array.from({ length: 14 }, (_, i) => i);
      pool.run.mockResolvedValue(noiseOutput({ gate: { width: 14, height: 1, cells } }));
      dinov2.patchDistances.mockResolvedValue({
        distances: cells.map((cell) => 0.1 + cell / 1000),
        width: 14,
        height: 1,
      });

      const result = await service.analyse(analysedRun(), config());

      const regions = (result.dinov2 as { regions: { x: number; weight: number }[] }).regions;
      expect(regions).toHaveLength(10);
      expect(regions[0]).toMatchObject({ x: 13 * 14, weight: 0.113 });
      expect(regions[9].weight).toBeCloseTo(0.104);
    });

    it('falls back to the blur verdict when DINOv2 is unavailable', async () => {
      const { service, dinov2 } = build();
      dinov2.patchDistances.mockResolvedValue(null);

      const result = await service.analyse(analysedRun(), config());

      expect(result.dinov2).toEqual({ error: 'dinov2 unavailable' });
      expect(result).toMatchObject({ verdict: 'noise', score: 0.5, reason: null });
    });

    it('uses the distance threshold of the config', async () => {
      const { service, dinov2 } = build();
      dinov2.patchDistances.mockResolvedValue(distances({ 5: 0.1 }));

      const result = await service.analyse(
        analysedRun(),
        config({ dinov2: { enabled: true, distanceThreshold: 0.05 } })
      );

      expect(result).toMatchObject({ verdict: 'change', score: 1 });
    });
  });

  it('returns a result that survives a JSON round trip unchanged', async () => {
    const { service, dinov2 } = build();
    dinov2.patchDistances.mockResolvedValue(distances({ 5: 0.23 }));

    const result = await service.analyse(analysedRun(), config());

    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe('NoiseHintService.enqueue', () => {
  afterEach(() => jest.restoreAllMocks());

  const isPending = ([run]: [TestRun]) => (run.noiseAnalysis as { pending?: boolean } | null)?.pending === true;

  const announced = (h: ReturnType<typeof build>) => h.events.testRunUpdated.mock.calls.filter(isPending);

  const resultEvents = (h: ReturnType<typeof build>) => h.events.testRunUpdated.mock.calls.filter((c) => !isPending(c));

  const analysed = async (h: ReturnType<typeof build>, count: number) => settled(() => resultEvents(h).length >= count);

  const stored = (h: ReturnType<typeof build>, id: string) =>
    h.store.get(id)?.noiseAnalysis as unknown as NoiseAnalysisResult | { pending: true; requestedAt: string } | null;

  const markerWrites = (h: ReturnType<typeof build>) =>
    h.prisma.testRun.updateMany.mock.calls.filter(([{ where }]) => typeof where.id !== 'string');

  it('marks eligible runs pending with one updateMany and analyses them one by one', async () => {
    const h = build();
    h.add('a');
    h.add('b');

    const answer = await h.service.enqueue(['a', 'b']);

    expect(answer).toEqual({ queued: 2, skipped: [] });
    expect(markerWrites(h)).toEqual([
      [
        {
          where: { id: { in: ['a', 'b'] }, status: TestStatus.unresolved },
          data: { noiseAnalysis: { pending: true, requestedAt: expect.any(String) } },
        },
      ],
    ]);
    await analysed(h, 2);
    expect(stored(h, 'a')).toMatchObject({ version: 1, verdict: 'noise' });
    expect(stored(h, 'b')).toMatchObject({ version: 1, verdict: 'noise' });
    expect(h.events.testRunUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('announces each marked run once, carrying the pending marker', async () => {
    const h = build();
    h.add('a');
    h.add('b');
    const gate = deferred<BlurAmplitudeJobOutput>();
    h.pool.run.mockReturnValueOnce(gate.promise);

    await h.service.enqueue(['a', 'b']);

    expect(announced(h).map(([run]) => run.id)).toEqual(['a', 'b']);
    announced(h).forEach(([run]) =>
      expect(run.noiseAnalysis).toEqual({ pending: true, requestedAt: expect.any(String) })
    );
    gate.resolve(noiseOutput());
    await analysed(h, 2);
  });

  it('announces only the runs it marked when one was decided before the write', async () => {
    const h = build();
    h.add('a');
    h.add('b');
    const lookup = h.prisma.testRun.findMany.getMockImplementation() as (args: {
      where: Where;
    }) => Promise<StoredRun[]>;
    h.prisma.testRun.findMany.mockImplementationOnce(async (args: { where: Where }) => {
      const runs = await lookup(args);
      h.store.set('a', { ...(h.store.get('a') as StoredRun), status: TestStatus.approved });
      return runs;
    });
    const gate = deferred<BlurAmplitudeJobOutput>();
    h.pool.run.mockReturnValueOnce(gate.promise);

    await h.service.enqueue(['a', 'b']);

    expect(announced(h).map(([run]) => run.id)).toEqual(['b']);
    gate.resolve(noiseOutput());
    await analysed(h, 1);
  });

  it('announces nothing when the write marked no run', async () => {
    const h = build();
    h.add('a');
    h.prisma.testRun.updateMany.mockResolvedValueOnce({ count: 0 });

    await h.service.enqueue(['a']);

    expect(h.prisma.testRun.findMany).toHaveBeenCalledTimes(1);
    expect(announced(h)).toHaveLength(0);
  });

  it('queues the runs and logs when announcing them fails', async () => {
    const h = build();
    h.add('a');
    h.add('b');
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    h.events.testRunUpdated.mockImplementationOnce(() => {
      throw new Error('socket gone');
    });

    const answer = await h.service.enqueue(['a', 'b']);

    expect(answer).toEqual({ queued: 2, skipped: [] });
    expect(announced(h)).toHaveLength(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('socket gone'));
    await analysed(h, 2);
    expect(stored(h, 'b')).toMatchObject({ version: 1 });
  });

  it('queues the runs and logs when reading them back fails', async () => {
    const h = build();
    h.add('a');
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const lookup = h.prisma.testRun.findMany.getMockImplementation() as (args: {
      where: Where;
    }) => Promise<StoredRun[]>;
    h.prisma.testRun.findMany.mockImplementationOnce(lookup).mockRejectedValueOnce(new Error('db gone'));

    const answer = await h.service.enqueue(['a']);

    expect(answer).toEqual({ queued: 1, skipped: [] });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('db gone'));
    await analysed(h, 1);
  });

  it('does not write anything when nothing is eligible', async () => {
    const h = build();
    h.add('a', { status: TestStatus.approved });

    const answer = await h.service.enqueue(['a']);

    expect(answer).toEqual({ queued: 0, skipped: [{ id: 'a', reason: 'not unresolved' }] });
    expect(h.prisma.testRun.updateMany).not.toHaveBeenCalled();
  });

  it('skips unknown ids as not unresolved', async () => {
    const h = build();

    const answer = await h.service.enqueue(['ghost']);

    expect(answer.skipped).toEqual([{ id: 'ghost', reason: 'not unresolved' }]);
  });

  it('decides per project when runs of several projects come in one request', async () => {
    const h = build();
    const off = { ...TEST_PROJECT, id: 'off', noiseAnalysisConfig: '{"blur":{"enabled":false}}' };
    const vlm = { ...TEST_PROJECT, id: 'vlm', imageComparison: ImageComparison.vlm };
    h.add('on');
    h.add('off', { project: off });
    h.add('vlm', { project: vlm });
    h.add('orphan', { project: null });
    h.add('decided', { status: TestStatus.approved });

    const answer = await h.service.enqueue(['on', 'off', 'vlm', 'orphan', 'decided']);

    expect(answer).toEqual({
      queued: 1,
      skipped: [
        { id: 'off', reason: 'analysis off' },
        { id: 'vlm', reason: 'analysis off' },
        { id: 'orphan', reason: 'analysis off' },
        { id: 'decided', reason: 'not unresolved' },
      ],
    });
    expect(markerWrites(h)[0][0].where).toEqual({ id: { in: ['on'] }, status: TestStatus.unresolved });
  });

  it('counts an id repeated in one request once', async () => {
    const h = build();
    h.add('a');

    const answer = await h.service.enqueue(['a', 'a']);

    expect(answer.queued).toBe(1);
  });

  it('accepts an id once when two requests overlap', async () => {
    const h = build();
    h.add('a');

    const [first, second] = await Promise.all([h.service.enqueue(['a']), h.service.enqueue(['a'])]);

    expect(first.queued + second.queued).toBe(1);
    expect(markerWrites(h)).toHaveLength(1);
    await analysed(h, 1);
    await settled(() => h.pool.run.mock.calls.length === 1);
    expect(h.pool.run).toHaveBeenCalledTimes(1);
  });

  it('does not let overlapping requests exceed 256 waiting', async () => {
    const h = build();
    const ids = Array.from({ length: 400 }, (_, i) => `run-${i}`);
    ids.forEach((id) => h.add(id));
    const gate = deferred<BlurAmplitudeJobOutput>();
    h.pool.run.mockReturnValueOnce(gate.promise);
    await h.service.enqueue([ids[0]]);

    const [first, second] = await Promise.all([
      h.service.enqueue(ids.slice(1, 201)),
      h.service.enqueue(ids.slice(201)),
    ]);

    expect(first.queued + second.queued).toBe(256);
    expect(first.skipped.length + second.skipped.length).toBe(143);
    expect([...first.skipped, ...second.skipped].every(({ reason }) => reason === 'queue full')).toBe(true);
    gate.resolve(noiseOutput());
    await analysed(h, 257);
  });

  it('frees the ids of a request whose database write failed', async () => {
    const h = build();
    h.add('a');
    h.add('b');
    h.prisma.testRun.updateMany.mockRejectedValueOnce(new Error('db gone'));

    await expect(h.service.enqueue(['a', 'b'])).rejects.toThrow('db gone');
    const again = await h.service.enqueue(['a', 'b']);

    expect(again.queued).toBe(2);
    await analysed(h, 2);
  });

  it('frees the ids of a request whose lookup failed', async () => {
    const h = build();
    h.add('a');
    h.prisma.testRun.findMany.mockRejectedValueOnce(new Error('db gone'));

    await expect(h.service.enqueue(['a'])).rejects.toThrow('db gone');
    const again = await h.service.enqueue(['a']);

    expect(again.queued).toBe(1);
    await analysed(h, 1);
  });

  it('frees an id that turned out ineligible so a later request can take it', async () => {
    const h = build();
    h.add('a', { status: TestStatus.approved });
    await h.service.enqueue(['a']);
    h.add('a');

    const again = await h.service.enqueue(['a']);

    expect(again.queued).toBe(1);
    await analysed(h, 1);
  });

  describe('with a busy worker', () => {
    const blocked = (h: ReturnType<typeof build>) => {
      const gate = deferred<BlurAmplitudeJobOutput>();
      h.pool.run.mockReturnValueOnce(gate.promise);
      return gate;
    };

    it('does not queue or mark an id that is already queued, in flight or waiting', async () => {
      const h = build();
      h.add('a');
      h.add('b');
      const gate = blocked(h);
      await h.service.enqueue(['a']);
      await h.service.enqueue(['b']);

      const again = await h.service.enqueue(['a', 'b']);

      expect(again).toEqual({ queued: 0, skipped: [] });
      expect(markerWrites(h)).toHaveLength(2);
      gate.resolve(noiseOutput());
      await analysed(h, 2);
      expect(h.pool.run).toHaveBeenCalledTimes(2);
    });

    it('queues an id again once its analysis has finished', async () => {
      const h = build();
      h.add('a');
      await h.service.enqueue(['a']);
      await analysed(h, 1);
      await settled(() => h.pool.run.mock.calls.length === 1);

      const again = await h.service.enqueue(['a']);

      expect(again.queued).toBe(1);
      await analysed(h, 2);
    });

    it('refuses runs beyond 256 waiting with "queue full"', async () => {
      const h = build();
      const ids = Array.from({ length: 258 }, (_, i) => `run-${i}`);
      ids.forEach((id) => h.add(id));
      const gate = blocked(h);
      await h.service.enqueue([ids[0]]);

      const answer = await h.service.enqueue(ids.slice(1));

      expect(answer.queued).toBe(256);
      expect(answer.skipped).toEqual([{ id: 'run-257', reason: 'queue full' }]);
      expect(markerWrites(h).at(-1)?.[0].where).toEqual({
        id: { in: ids.slice(1, 257) },
        status: TestStatus.unresolved,
      });
      gate.resolve(noiseOutput());
      await analysed(h, 257);
    });

    it('drops the waiting runs on shutdown and leaves them pending in the database', async () => {
      const h = build();
      h.add('a');
      h.add('b');
      const gate = blocked(h);
      await h.service.enqueue(['a', 'b']);

      h.service.onApplicationShutdown();
      gate.resolve(noiseOutput());
      await analysed(h, 1);
      await settled(() => h.pool.run.mock.calls.length === 1);

      expect(h.pool.run).toHaveBeenCalledTimes(1);
      expect(stored(h, 'a')).toMatchObject({ version: 1 });
      expect(stored(h, 'b')).toMatchObject({ pending: true });
    });
  });

  describe('processing a run', () => {
    const decideBeforeProcessing = (h: ReturnType<typeof build>, id: string, patch: Partial<StoredRun>) =>
      h.prisma.testRun.findUnique.mockImplementationOnce(({ where }: { where: { id: string } }) => {
        const run = { ...(h.store.get(where.id) as StoredRun), ...patch };
        h.store.set(where.id, run);
        return Promise.resolve(run);
      });

    it('clears the marker of a run that was decided after it was queued, without analysing it', async () => {
      const h = build();
      h.add('a');
      h.add('b');
      decideBeforeProcessing(h, 'a', { status: TestStatus.approved });

      await h.service.enqueue(['a', 'b']);
      await analysed(h, 2);

      expect(stored(h, 'a')).toBeNull();
      expect(stored(h, 'b')).toMatchObject({ version: 1 });
      expect(h.pool.run).toHaveBeenCalledTimes(1);
      expect(h.events.testRunUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    });

    it.each([
      ['a diff recalculated since', null],
      ['a finished analysis', { version: 1, verdict: 'noise' }],
      ['a list value', [PENDING]],
      ['a pending marker without a date', { pending: true }],
    ])('writes nothing to a run whose field holds %s', async (_name, noiseAnalysis) => {
      const h = build();
      h.add('a');
      h.add('b');
      decideBeforeProcessing(h, 'a', { noiseAnalysis: noiseAnalysis });

      await h.service.enqueue(['a', 'b']);
      await analysed(h, 1);

      expect(stored(h, 'a')).toEqual(noiseAnalysis);
      expect(stored(h, 'b')).toMatchObject({ version: 1 });
      expect(h.pool.run).toHaveBeenCalledTimes(1);
    });

    it('skips a run that disappeared or lost its project', async () => {
      const h = build();
      h.add('a');
      h.add('b');
      h.add('c');
      h.prisma.testRun.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...storedRun('b'), project: null, noiseAnalysis: PENDING });

      await h.service.enqueue(['a', 'b', 'c']);
      await analysed(h, 1);

      expect(h.pool.run).toHaveBeenCalledTimes(1);
      expect(stored(h, 'c')).toMatchObject({ version: 1 });
      expect(stored(h, 'a')).toMatchObject({ pending: true });
    });

    it('analyses with the current config of the project', async () => {
      const h = build();
      h.add('a', {
        project: {
          ...TEST_PROJECT,
          noiseAnalysisConfig: '{"dinov2":{"enabled":false},"blur":{"amplitudeThreshold":50}}',
        },
      });

      await h.service.enqueue(['a']);
      await analysed(h, 1);

      const result = stored(h, 'a') as NoiseAnalysisResult;
      expect(result.config.blur.amplitudeThreshold).toBe(50);
      expect(result.dinov2).toEqual({ skipped: 'off' });
    });

    describe('when the run changes during the analysis', () => {
      const changeDuringAnalysis = async (h: ReturnType<typeof build>, patch: Partial<StoredRun>) => {
        const gate = deferred<BlurAmplitudeJobOutput>();
        h.pool.run.mockReturnValueOnce(gate.promise);
        await h.service.enqueue(['a']);
        await settled(() => h.pool.run.mock.calls.length === 1);
        h.store.set('a', { ...(h.store.get('a') as StoredRun), ...patch });
        gate.resolve(noiseOutput());
        await settled(() => h.prisma.testRun.updateMany.mock.calls.length >= 2);
        await new Promise((resolve) => setImmediate(resolve));
      };

      it('does not write the stale result over a recalculated diff', async () => {
        const h = build();
        h.add('a');

        await changeDuringAnalysis(h, { noiseAnalysis: null });

        expect(stored(h, 'a')).toBeNull();
        expect(resultEvents(h)).toHaveLength(0);
      });

      it('does not write the stale result over a newer request', async () => {
        const h = build();
        h.add('a');
        const newer = { pending: true, requestedAt: '2099-01-01T00:00:00.000Z' };

        await changeDuringAnalysis(h, { noiseAnalysis: newer });

        expect(stored(h, 'a')).toEqual(newer);
        expect(resultEvents(h)).toHaveLength(0);
      });

      it('clears the marker instead of writing a result when the run was decided meanwhile', async () => {
        const h = build();
        h.add('a');

        await changeDuringAnalysis(h, { status: TestStatus.approved });
        await analysed(h, 1);

        expect(stored(h, 'a')).toBeNull();
        expect(resultEvents(h)).toHaveLength(1);
      });

      it('guards the result write with the status and the marker it read', async () => {
        const h = build();
        h.add('a');

        await changeDuringAnalysis(h, {});
        await analysed(h, 1);

        expect(h.prisma.testRun.updateMany).toHaveBeenLastCalledWith({
          where: {
            id: 'a',
            status: TestStatus.unresolved,
            noiseAnalysis: { path: ['requestedAt'], equals: expect.any(String) },
          },
          data: { noiseAnalysis: expect.objectContaining({ version: 1 }) },
        });
      });
    });

    it('skips the event when the run vanished right after the write', async () => {
      const h = build();
      h.add('a');
      h.prisma.testRun.findUnique
        .mockImplementationOnce(({ where }: { where: { id: string } }) => Promise.resolve(h.store.get(where.id)))
        .mockResolvedValueOnce(null);

      await h.service.enqueue(['a']);
      await settled(() => h.prisma.testRun.findUnique.mock.calls.length === 2);

      expect(resultEvents(h)).toHaveLength(0);
    });

    it('resets the field to null, logs once and carries on when an analysis fails', async () => {
      const h = build();
      h.add('a');
      h.add('b');
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      h.pool.run.mockRejectedValueOnce(new Error('worker crashed'));

      await h.service.enqueue(['a', 'b']);
      await analysed(h, 2);

      expect(h.prisma.testRun.update).toHaveBeenCalledWith({
        where: { id: 'a' },
        data: { noiseAnalysis: Prisma.DbNull },
      });
      expect(stored(h, 'a')).toBeNull();
      expect(stored(h, 'b')).toMatchObject({ version: 1 });
      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('worker crashed'));
    });

    it('logs and moves on when even the reset fails', async () => {
      const h = build();
      h.add('a');
      h.add('b');
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      h.pool.run.mockRejectedValueOnce(new Error('worker crashed'));
      h.prisma.testRun.update.mockRejectedValueOnce(new Error('db gone'));

      await h.service.enqueue(['a', 'b']);
      await analysed(h, 1);

      expect(error).toHaveBeenCalledWith(expect.stringContaining('db gone'));
      expect(stored(h, 'b')).toMatchObject({ version: 1 });
    });
  });
});
