import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { TestStatus } from '@prisma/client';
import { PNG } from 'pngjs';
import { StaticService } from '../../../static/static.service';
import { DiffWorkerPool } from '../../diff-worker-pool';
import { DIFF_DIMENSION_RESULT, EQUAL_RESULT, NO_BASELINE_RESULT } from '../consts';
import { DEFAULT_CONFIG, LookSameService } from './looks-same.service';
import { LooksSameConfig } from './looks-same.types';
import { ImageCompareInput } from '../ImageCompareInput';

const baselineBuffer = PNG.sync.write(new PNG({ width: 20, height: 20 }));
const another = new PNG({ width: 20, height: 20 });
another.data[0] = 1;
const imageBuffer = PNG.sync.write(another);

interface Deps {
  getImageBuffer?: jest.Mock;
  saveImage?: jest.Mock;
  run?: jest.Mock;
}

const setup = async ({
  getImageBuffer = jest.fn().mockResolvedValueOnce(baselineBuffer).mockResolvedValueOnce(imageBuffer),
  saveImage = jest.fn(),
  run = jest.fn(),
}: Deps = {}) => {
  const module = await Test.createTestingModule({
    providers: [
      LookSameService,
      { provide: DiffWorkerPool, useValue: { run } },
      { provide: StaticService, useValue: { getImageBuffer, saveImage } },
    ],
  }).compile();
  return { service: module.get(LookSameService), getImageBuffer, saveImage, run };
};

const input: ImageCompareInput = {
  baseline: 'baseline',
  image: 'image',
  diffTollerancePercent: 0.1,
  ignoreAreas: [],
  saveDiffAsFile: true,
};

const diff = (
  service: LookSameService,
  extra: Partial<ImageCompareInput> = {},
  config: LooksSameConfig = DEFAULT_CONFIG
) => service.getDiff({ ...input, ...extra }, config);

const outcome = (name: string) => jest.fn().mockResolvedValue({ outcome: name });

const compared = (
  result: { equal: boolean; differentPixels?: number; totalPixels?: number } | null,
  extra: { diffPng?: Uint8Array; errors?: string[] } = {}
) => jest.fn().mockResolvedValue({ outcome: 'compared', isSameDimension: true, result, errors: [], ...extra });

const verdict = (
  status: TestStatus,
  diffName: string | null,
  diffPercent: number | undefined,
  pixelMisMatchCount?: number
) => ({
  status,
  diffName,
  diffPercent,
  pixelMisMatchCount,
  isSameDimension: true,
});

const twentyOfFourHundred = { equal: false, differentPixels: 20, totalPixels: 400 };
const diffPng = new Uint8Array(Buffer.from('png'));

let loggerError: jest.SpyInstance;

beforeEach(() => {
  loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('parseConfig', () => {
  it.each<[string, LooksSameConfig]>([
    [
      '{"strict":false,"tolerance":122.1,"antialiasingTolerance":2,"ignoreAntialiasing":true,"ignoreCaret":true,"allowDiffDimensions":true}',
      {
        strict: false,
        tolerance: 122.1,
        antialiasingTolerance: 2,
        ignoreAntialiasing: true,
        ignoreCaret: true,
        allowDiffDimensions: true,
      },
    ],
    ['', DEFAULT_CONFIG],
    ['invalid', DEFAULT_CONFIG],
  ])('should parse config', async (json, expected) => {
    const { service } = await setup();

    expect(service.parseConfig(json)).toStrictEqual(expected);
  });
});

describe('getDiff', () => {
  it('no baseline', async () => {
    const { service, run } = await setup({
      getImageBuffer: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(imageBuffer),
    });

    expect(await diff(service, { baseline: null })).toStrictEqual(NO_BASELINE_RESULT);
    expect(run).not.toHaveBeenCalled();
  });

  it('compares the image it is given without reading it again', async () => {
    const { service, getImageBuffer, run } = await setup({
      getImageBuffer: jest.fn().mockResolvedValue(baselineBuffer),
      run: outcome('equal'),
    });

    await diff(service, { imageBuffer });

    expect(getImageBuffer).toHaveBeenCalledTimes(1);
    expect(getImageBuffer).toHaveBeenCalledWith('baseline');
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ baseline: baselineBuffer, image: imageBuffer }));
  });

  it('reports no baseline when the baseline cannot be read', async () => {
    const { service, run } = await setup({
      getImageBuffer: jest.fn().mockRejectedValueOnce(new Error('disk')).mockResolvedValueOnce(imageBuffer),
    });

    expect(await diff(service)).toStrictEqual(NO_BASELINE_RESULT);
    expect(run).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith('disk');
  });

  it('reports no baseline when the job finds it unreadable', async () => {
    const { service } = await setup({ run: outcome('baseline-unreadable') });

    await expect(diff(service)).resolves.toStrictEqual(NO_BASELINE_RESULT);
  });

  it('answers EQUAL for byte-equal well-formed PNGs without a job', async () => {
    const { service, run } = await setup({ getImageBuffer: jest.fn().mockResolvedValue(baselineBuffer) });

    expect(await diff(service)).toStrictEqual(EQUAL_RESULT);
    expect(run).not.toHaveBeenCalled();
  });

  it('hands byte-equal files that are not well-formed PNGs to the job', async () => {
    const { service, run } = await setup({
      getImageBuffer: jest.fn().mockResolvedValue(Buffer.from('not a png')),
      run: outcome('baseline-unreadable'),
    });

    await diff(service);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['equal images', 'equal', EQUAL_RESULT],
    ['diff image dimensions mismatch', 'diff-dimension', DIFF_DIMENSION_RESULT],
  ])('%s', async (_, name, expected) => {
    const { service } = await setup({ run: outcome(name) });

    expect(await diff(service)).toStrictEqual(expected);
  });

  it('throws a clear error when the image cannot be read', async () => {
    const { service, run } = await setup({
      getImageBuffer: jest.fn().mockResolvedValueOnce(baselineBuffer).mockResolvedValueOnce(null),
    });

    await expect(diff(service, { saveDiffAsFile: false })).rejects.toThrow('Cannot get image: image');
    expect(run).not.toHaveBeenCalled();
  });

  it('throws a clear error when the job finds the image unreadable', async () => {
    const { service } = await setup({ run: outcome('image-unreadable') });

    await expect(diff(service, { saveDiffAsFile: false })).rejects.toThrow('Cannot get image: image');
  });

  it('diff not found', async () => {
    const { service } = await setup({ run: compared({ equal: true, differentPixels: 0, totalPixels: 400 }) });

    expect(await diff(service)).toStrictEqual(verdict(TestStatus.ok, null, 0, 0));
  });

  it('diff found', async () => {
    const { service, saveImage } = await setup({ run: compared(twentyOfFourHundred) });

    const result = await diff(service, { saveDiffAsFile: false });

    expect(saveImage).not.toHaveBeenCalled();
    expect(result).toStrictEqual(verdict(TestStatus.unresolved, null, 5, 20));
  });

  it('diff found and save diff', async () => {
    const { service, saveImage } = await setup({
      run: compared(twentyOfFourHundred, { diffPng }),
      saveImage: jest.fn().mockResolvedValueOnce('diff name'),
    });

    const result = await diff(service);

    expect(saveImage).toHaveBeenCalledWith('diff', Buffer.from('png'));
    expect(saveImage.mock.calls[0][1]).toBeInstanceOf(Buffer);
    expect(result).toStrictEqual(verdict(TestStatus.unresolved, 'diff name', 5, 20));
  });

  it('ok, without a diff, when the change is within the tolerance', async () => {
    const { service, saveImage } = await setup({ run: compared(twentyOfFourHundred) });

    const result = await diff(service, { diffTollerancePercent: 5 });

    expect(saveImage).not.toHaveBeenCalled();
    expect(result).toStrictEqual(verdict(TestStatus.ok, null, 5, 20));
  });

  it('comparison failed', async () => {
    const { service } = await setup({ run: compared(null) });

    expect(await diff(service)).toStrictEqual(verdict(TestStatus.unresolved, null, undefined));
  });

  it('reports a 0% diff when Looks-Same counts no pixels at all', async () => {
    const { service } = await setup({ run: compared({ equal: false, differentPixels: 0, totalPixels: 0 }) });

    expect(await diff(service, { saveDiffAsFile: false })).toStrictEqual(verdict(TestStatus.unresolved, null, 0, 0));
  });

  it('logs what looks-same refused', async () => {
    const { service } = await setup({ run: compared(null, { errors: ['a', 'b'] }) });

    await diff(service, { saveDiffAsFile: false });

    expect(loggerError.mock.calls).toEqual([['a'], ['b']]);
  });

  it('passes the project config, the ignore areas and saveDiffAsFile to the job', async () => {
    const { service, run } = await setup({ run: outcome('equal') });
    const config = { ...DEFAULT_CONFIG, tolerance: 3, strict: undefined };
    const ignoreAreas = [{ x: 1, y: 2, width: 3, height: 4 }];

    await diff(service, { ignoreAreas }, config);

    expect(run).toHaveBeenCalledWith({
      kind: 'looks-same',
      baseline: baselineBuffer,
      image: imageBuffer,
      ignoreAreas,
      config,
      saveDiff: true,
    });
  });

  it('keeps the compared outcome when the diff cannot be saved', async () => {
    const { service } = await setup({
      run: compared(twentyOfFourHundred, { diffPng }),
      saveImage: jest.fn().mockRejectedValueOnce(new Error('disk full')),
    });

    expect(await diff(service)).toMatchObject({
      status: TestStatus.unresolved,
      diffName: null,
      pixelMisMatchCount: 20,
    });
  });
});

describe('saveDiff', () => {
  it('returns null when there is no diff image', async () => {
    const { service, saveImage } = await setup();

    await expect(service.saveDiff(undefined)).resolves.toBeNull();
    expect(saveImage).not.toHaveBeenCalled();
  });

  it('returns null when the diff cannot be saved', async () => {
    const { service } = await setup({ saveImage: jest.fn().mockRejectedValueOnce(new Error('disk full')) });

    expect(await service.saveDiff(diffPng)).toBeNull();
  });

  it('saves only the bytes of a view into a larger buffer', async () => {
    const { service, saveImage } = await setup({ saveImage: jest.fn().mockResolvedValueOnce('diff name') });
    const whole = Buffer.from('xxpngxx');

    const result = await service.saveDiff(new Uint8Array(whole.buffer, whole.byteOffset + 2, 3));

    expect(result).toBe('diff name');
    expect(saveImage.mock.calls[0][1].toString()).toBe('png');
  });
});
