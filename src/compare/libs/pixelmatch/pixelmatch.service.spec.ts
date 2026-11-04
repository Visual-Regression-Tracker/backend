import { TestingModule, Test } from '@nestjs/testing';
import { TestStatus } from '@prisma/client';
import Pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { mocked } from 'jest-mock';
import { StaticService } from '../../../static/static.service';
import { DiffWorkerPool } from '../../diff-worker-pool';
import { DIFF_DIMENSION_RESULT, EQUAL_RESULT, NO_BASELINE_RESULT } from '../consts';
import { ImageCompareInput } from '../ImageCompareInput';
import { DEFAULT_CONFIG, PixelmatchService } from './pixelmatch.service';
import { PixelmatchConfig } from './pixelmatch.types';
import { computePixelmatchDiff } from './pixelmatch.core';
import { paintedPng, pngBytes } from '../../test-utils';

jest.mock('pixelmatch');

const pngOf = (width: number, height: number) => PNG.sync.write(new PNG({ width, height }));
const toBuffer = (png: PNG): Buffer => PNG.sync.write(png);
const sequence = (...results: unknown[]) => results.reduce<jest.Mock>((m, r) => m.mockResolvedValueOnce(r), jest.fn());
const pngReader = () => jest.fn().mockResolvedValue(Buffer.from('png'));
const poolOf = (output: Record<string, unknown>) => ({ run: jest.fn().mockResolvedValue(output) });

interface Deps {
  getImageBuffer?: jest.Mock;
  saveImage?: jest.Mock;
  deleteImage?: jest.Mock;
  pool?: { run: unknown };
}

const setup = async ({
  getImageBuffer = jest.fn(),
  saveImage = jest.fn(),
  deleteImage = jest.fn(),
  pool,
}: Deps = {}) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PixelmatchService,
      pool ? { provide: DiffWorkerPool, useValue: pool } : DiffWorkerPool,
      { provide: StaticService, useValue: { getImageBuffer, saveImage, deleteImage } },
    ],
  }).compile();
  return {
    service: module.get(PixelmatchService),
    run: pool?.run as jest.Mock,
    getImageBuffer,
    saveImage,
    deleteImage,
  };
};

const compare = (
  service: PixelmatchService,
  data: Partial<ImageCompareInput> = {},
  config: PixelmatchConfig = DEFAULT_CONFIG
) =>
  service.getDiff(
    {
      baseline: 'baseline.png',
      image: 'image.png',
      ignoreAreas: [],
      diffTollerancePercent: 0,
      saveDiffAsFile: false,
      ...data,
    },
    config
  );

const mismatch = { equal: false, isSameDimension: true, pixelMisMatchCount: 10, diffPercent: 5 };

describe('parseConfig', () => {
  it.each<[string, PixelmatchConfig]>([
    [
      '{"threshold":21.2,"ignoreAntialiasing":false,"allowDiffDimensions":true}',
      { threshold: 21.2, ignoreAntialiasing: false, allowDiffDimensions: true },
    ],
    ['', DEFAULT_CONFIG],
    ['invalid', DEFAULT_CONFIG],
    ['null', DEFAULT_CONFIG],
  ])('should parse config', async (json, expected) => {
    const { service } = await setup();

    expect(service.parseConfig(json)).toStrictEqual(expected);
  });
});

describe('getDiff', () => {
  const image = new PNG({ width: 20, height: 20 });
  const flagged = (baseline: number | undefined = undefined) => {
    const png = new PNG({ width: 100, height: 100 });
    if (baseline !== undefined) png.data[0] = baseline;
    return toBuffer(png);
  };

  it('no baseline', async () => {
    const { service } = await setup({ getImageBuffer: sequence(undefined, toBuffer(image)) });

    expect(await compare(service, { baseline: null, saveDiffAsFile: true })).toStrictEqual(NO_BASELINE_RESULT);
  });

  it('throws when the image cannot be read', async () => {
    const { service, getImageBuffer } = await setup({ getImageBuffer: sequence(toBuffer(image), undefined) });

    await expect(compare(service, { image: 'missing.png', saveDiffAsFile: true })).rejects.toThrow(
      'Cannot get image: missing.png'
    );
    expect(getImageBuffer).toHaveBeenNthCalledWith(2, 'missing.png');
  });

  it('diff not found', async () => {
    const { service } = await setup({ getImageBuffer: sequence(toBuffer(image), toBuffer(image)) });

    expect(await compare(service, { saveDiffAsFile: true })).toStrictEqual(EQUAL_RESULT);
  });

  it('diff image dimensions mismatch', async () => {
    const { service } = await setup({ getImageBuffer: sequence(pngOf(10, 10), toBuffer(image)) });

    expect(await compare(service, { saveDiffAsFile: true })).toStrictEqual(DIFF_DIMENSION_RESULT);
  });

  it('diff image dimensions mismatch ALLOWED', async () => {
    const diffName = 'diff name';
    mocked(Pixelmatch).mockReturnValueOnce(5);
    const { service, saveImage } = await setup({
      getImageBuffer: sequence(pngOf(1, 5), pngOf(2, 4)),
      saveImage: sequence(diffName),
    });

    const result = await compare(
      service,
      { diffTollerancePercent: 0.1, saveDiffAsFile: true },
      { allowDiffDimensions: true, ignoreAntialiasing: true, threshold: 0.1 }
    );

    const padded = new PNG({ width: 2, height: 5 }).data;
    expect(mocked(Pixelmatch)).toHaveBeenCalledWith(padded, padded, padded, 2, 5, { includeAA: true, threshold: 0.1 });
    expect(saveImage.mock.calls[0][0]).toBe('diff');
    expect(saveImage).toHaveBeenCalledTimes(3);
    expect(result).toStrictEqual({
      status: TestStatus.unresolved,
      diffName,
      pixelMisMatchCount: 5,
      diffPercent: 50,
      isSameDimension: false,
    });
  });

  it.each([
    ['below', 2, false, 150, 1.5, TestStatus.ok, null, 0],
    ['above', 0.5, true, 200, 2, TestStatus.unresolved, 'diff name', 3],
  ])(
    'diff found %s tollerance',
    async (_, diffTollerancePercent, saveDiffAsFile, pixelMisMatchCount, diffPercent, status, diffName, saves) => {
      mocked(Pixelmatch).mockReturnValueOnce(pixelMisMatchCount);
      const { service, saveImage } = await setup({
        getImageBuffer: sequence(flagged(1), flagged()),
        saveImage: sequence('diff name'),
      });

      const result = await compare(service, { diffTollerancePercent, saveDiffAsFile });

      if (saves) expect(saveImage.mock.calls[0][0]).toBe('diff');
      expect(saveImage).toHaveBeenCalledTimes(saves);
      expect(result).toStrictEqual({ status, diffName, pixelMisMatchCount, diffPercent, isSameDimension: true });
    }
  );
});

describe('byte-equal fast path', () => {
  const valid = pngOf(4, 4);

  it('answers EQUAL for byte-equal well-formed PNGs without queueing a job', async () => {
    const pool = { run: jest.fn() };
    const { service } = await setup({ pool, getImageBuffer: sequence(Buffer.from(valid), Buffer.from(valid)) });

    await expect(compare(service, { saveDiffAsFile: true })).resolves.toStrictEqual(EQUAL_RESULT);
    expect(pool.run).not.toHaveBeenCalled();
  });

  it('still sends a byte-equal pair to the worker when the PNG is not well formed', async () => {
    const truncated = valid.subarray(0, valid.length - 20);
    const pool = new DiffWorkerPool();
    const run = jest.spyOn(pool, 'run');
    const { service } = await setup({ pool, getImageBuffer: sequence(Buffer.from(truncated), Buffer.from(truncated)) });

    await expect(compare(service, { saveDiffAsFile: true })).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('sends different buffers to the worker', async () => {
    const other = new PNG({ width: 4, height: 4 });
    other.data.fill(255);
    const pool = poolOf({ equal: true });
    const { service } = await setup({ pool, getImageBuffer: sequence(Buffer.from(valid), toBuffer(other)) });

    await compare(service, { saveDiffAsFile: true });

    expect(pool.run).toHaveBeenCalledTimes(1);
  });
});

describe('image already in memory', () => {
  it('uses the image it is given and reads only the baseline', async () => {
    const pool = poolOf({ equal: true });
    const { service, getImageBuffer } = await setup({
      pool,
      getImageBuffer: jest.fn().mockResolvedValue(Buffer.from('baseline bytes')),
    });
    const imageBuffer = Buffer.from('image bytes');

    await compare(service, { imageBuffer });

    expect(getImageBuffer).toHaveBeenCalledTimes(1);
    expect(getImageBuffer).toHaveBeenCalledWith('baseline.png');
    expect(pool.run.mock.calls[0][0].image).toBe(imageBuffer);
  });

  it('reads the image itself when none is given and fails as before when it is missing', async () => {
    const { service, getImageBuffer } = await setup({
      pool: { run: jest.fn() },
      getImageBuffer: sequence(Buffer.from('baseline bytes'), undefined),
    });

    await expect(compare(service)).rejects.toThrow('Cannot get image: image.png');
    expect(getImageBuffer).toHaveBeenNthCalledWith(2, 'image.png');
  });
});

describe('screenshots of another size', () => {
  const setupSizes = (baseline: Buffer, image: Buffer, run: jest.Mock) =>
    setup({ pool: { run }, getImageBuffer: sequence(baseline, image) });

  it('answers different sizes from the headers without the worker', async () => {
    const run = jest.fn();
    const { service } = await setupSizes(pngOf(2, 3), pngOf(3, 2), run);

    expect(await compare(service)).toBe(DIFF_DIMENSION_RESULT);
    expect(run).not.toHaveBeenCalled();
  });

  it('still sends different sizes to the worker when they are allowed', async () => {
    const run = jest
      .fn()
      .mockResolvedValue({ equal: false, isSameDimension: false, pixelMisMatchCount: 1, diffPercent: 1 });
    const { service } = await setupSizes(pngOf(2, 3), pngOf(3, 2), run);

    await compare(service, {}, { ...DEFAULT_CONFIG, allowDiffDimensions: true });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('sends buffers without a readable header to the worker', async () => {
    const run = jest.fn().mockResolvedValue({ equal: false, isSameDimension: false });
    const { service } = await setupSizes(Buffer.from('a'), Buffer.from('b'), run);

    expect(await compare(service)).toBe(DIFF_DIMENSION_RESULT);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('gives the result the worker gave for screenshots of different sizes', async () => {
    const baseline = pngOf(2, 3);
    const image = pngOf(3, 2);
    const output = computePixelmatchDiff({
      kind: 'diff',
      baseline,
      image,
      ignoreAreas: [],
      threshold: DEFAULT_CONFIG.threshold,
      includeAA: DEFAULT_CONFIG.ignoreAntialiasing,
      diffTolerancePercent: 0,
      saveDiff: false,
    });
    expect(output.isSameDimension).toBe(false);
    expect(output.equal).toBeFalsy();

    const run = jest.fn().mockImplementation(async (input) => computePixelmatchDiff(input));
    const { service } = await setupSizes(baseline, image, run);
    expect(await compare(service)).toStrictEqual(DIFF_DIMENSION_RESULT);
  });
});

describe('change signature', () => {
  it('asks for a signature and carries it into the result', async () => {
    const { service, run } = await setup({
      pool: poolOf({ ...mismatch, signature: [0.25, 0.75] }),
      getImageBuffer: pngReader(),
    });

    const result = await compare(service, { saveDiffAsFile: true });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ kind: 'diff', saveDiff: true }));
    expect(result.changeSignature).toEqual({
      threshold: DEFAULT_CONFIG.threshold,
      includeAA: DEFAULT_CONFIG.ignoreAntialiasing,
      signature: [0.25, 0.75],
    });
  });

  it('does not ask for a signature for a comparison whose diff is thrown away', async () => {
    const { service, run } = await setup({ pool: poolOf(mismatch), getImageBuffer: pngReader() });

    const result = await compare(service);

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ saveDiff: false }));
    expect(result.changeSignature).toBeUndefined();
  });

  describe('thumbnails', () => {
    const overTolerance = {
      ...mismatch,
      imageThumbnail: Buffer.from('small image'),
      diffThumbnail: Buffer.from('small diff'),
      diffBuffer: Buffer.from('the diff'),
    };
    const setupSaving = (saveImage: jest.Mock, output: Record<string, unknown> = overTolerance) =>
      setup({ pool: poolOf(output), getImageBuffer: pngReader(), saveImage });
    const savedAs = (...names: (string | Error)[]) =>
      names.reduce<jest.Mock>(
        (m, name) => (name instanceof Error ? m.mockRejectedValueOnce(name) : m.mockResolvedValueOnce(name)),
        jest.fn()
      );

    it('saves the thumbnails and reports the names they went under', async () => {
      const { service } = await setupSaving(savedAs('diff.png', 'image.thumb.png', 'diff.thumb.png'));

      const result = await compare(service, { saveDiffAsFile: true });

      expect(result.imageThumbnailName).toBe('image.thumb.png');
      expect(result.diffThumbnailName).toBe('diff.thumb.png');
    });

    it('keeps the diff and the verdict when a thumbnail cannot be saved, and deletes the one that was', async () => {
      const { service, deleteImage } = await setupSaving(savedAs('diff.png', new Error('disk full'), 'diff.thumb.png'));

      const result = await compare(service, { saveDiffAsFile: true });

      expect(result).toMatchObject({ status: TestStatus.unresolved, diffName: 'diff.png' });
      expect(result.imageThumbnailName).toBeUndefined();
      expect(result.diffThumbnailName).toBeUndefined();
      expect(deleteImage).toHaveBeenCalledTimes(1);
      expect(deleteImage).toHaveBeenCalledWith('diff.thumb.png');
    });

    it('drops a thumbnail pair when one of the names comes back empty', async () => {
      const { service, deleteImage } = await setupSaving(savedAs('diff.png', '', 'diff.thumb.png'));

      const result = await compare(service, { saveDiffAsFile: true });

      expect(result.diffName).toBe('diff.png');
      expect(result.diffThumbnailName).toBeUndefined();
      expect(deleteImage).toHaveBeenCalledWith('diff.thumb.png');
    });

    it('stores nothing when the caller is not keeping the diff', async () => {
      const saveImage = savedAs('diff.png', 'image.thumb.png', 'diff.thumb.png');
      const { service } = await setupSaving(saveImage, { ...overTolerance, diffBuffer: undefined });

      const result = await compare(service);

      expect(saveImage).not.toHaveBeenCalled();
      expect(result.imageThumbnailName).toBeUndefined();
      expect(result.diffThumbnailName).toBeUndefined();
    });
  });
});

describe('ignoreRenderingNoise', () => {
  const hairline = (column: number): Buffer =>
    pngBytes(paintedPng(60, 60, (x) => (x === column ? [0, 0, 0] : undefined)));

  it.each([[true], [false]])('leaves a faint change unresolved with ignoreRenderingNoise %p', async (flag) => {
    mocked(Pixelmatch).mockImplementation(jest.requireActual('pixelmatch'));
    const run = jest.fn().mockImplementation(async (input) => computePixelmatchDiff(input));
    const { service } = await setup({
      pool: { run },
      getImageBuffer: sequence(hairline(10), hairline(11)),
      saveImage: jest.fn().mockResolvedValue('diff.png'),
    });
    const config = { ...DEFAULT_CONFIG, ignoreRenderingNoise: flag };
    const data = {
      baseline: 'b.png',
      image: 'i.png',
      ignoreAreas: [],
      diffTollerancePercent: 0,
      saveDiffAsFile: true,
      ignoreRenderingNoise: flag,
    };

    const result = await service.getDiff(data, config);

    expect(result.status).toBe(TestStatus.unresolved);
    expect(result.diffName).toBe('diff.png');
  });
});
