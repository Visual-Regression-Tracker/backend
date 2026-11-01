import { readFileSync } from 'fs';
import { join } from 'path';
import { Test } from '@nestjs/testing';
import { TestStatus } from '@prisma/client';
import { PNG } from 'pngjs';
import { StaticService } from '../../../static/static.service';
import { DiffWorkerPool } from '../../diff-worker-pool';
import { DIFF_DIMENSION_RESULT, EQUAL_RESULT } from '../consts';
import { solidPng } from '../../test-utils';
import { DEFAULT_CONFIG, LookSameService } from './looks-same.service';

const filled = (width: number, height: number, value: number): PNG => solidPng(width, height, [value, value, value]);

const encode = (png: PNG) => PNG.sync.write(png, { filterType: 0, deflateLevel: 1 });

const initService = async (baseline: PNG, image: PNG) => {
  const saveImage = jest.fn().mockResolvedValue('diff.png');
  const getImageBuffer = jest
    .fn()
    .mockImplementationOnce(async () => encode(baseline))
    .mockImplementationOnce(async () => encode(image));
  const module = await Test.createTestingModule({
    providers: [
      LookSameService,
      DiffWorkerPool,
      {
        provide: StaticService,
        useValue: {
          getImageBuffer,
          saveImage,
        },
      },
    ],
  }).compile();
  return { service: module.get(LookSameService), saveImage };
};

const input = { baseline: 'baseline', image: 'image', diffTollerancePercent: 0, ignoreAreas: [], saveDiffAsFile: true };

describe('LookSameService.getDiff dimensions', () => {
  it.each([
    ['a different height', filled(10, 10, 0), filled(10, 5, 0)],
    ['a different width', filled(10, 10, 0), filled(5, 10, 0)],
    ['a 60x30 and a 30x60 image of the same pixel bytes', filled(60, 30, 128), filled(30, 60, 128)],
  ])('reports %s as a dimension change', async (_, baseline, image) => {
    const { service } = await initService(baseline, image);

    await expect(service.getDiff(input, DEFAULT_CONFIG)).resolves.toBe(DIFF_DIMENSION_RESULT);
  });

  it('compares them when other sizes are allowed', async () => {
    const { service } = await initService(filled(60, 30, 128), filled(30, 60, 128));

    const result = await service.getDiff(input, { ...DEFAULT_CONFIG, allowDiffDimensions: true });

    expect(result).not.toBe(EQUAL_RESULT);
    expect(result.status).not.toBe(TestStatus.ok);
    expect(result.isSameDimension).toBe(false);
  });
});

describe('LookSameService.getDiff saving the diff', () => {
  it('stores the diff as a "diff" image', async () => {
    const { service, saveImage } = await initService(filled(10, 10, 0), filled(10, 10, 255));

    const result = await service.getDiff(input, DEFAULT_CONFIG);

    expect(result.status).toBe(TestStatus.unresolved);
    expect(result.diffName).toBe('diff.png');
    expect(saveImage).toHaveBeenCalledWith('diff', expect.any(Buffer));
    expect(PNG.sync.read(saveImage.mock.calls[0][1]).width).toBe(10);
  });
});

describe('characterization on the real looks-same', () => {
  const decoded = new Map<string, PNG>();
  const fixture = (name: string) => {
    if (!decoded.has(name)) {
      decoded.set(name, PNG.sync.read(readFileSync(join(__dirname, '../../../../test', name))));
    }
    return decoded.get(name) as PNG;
  };
  const fixtures = () => initService(fixture('image.png'), fixture('image_edited.png'));
  const ignoreFirstPixel = { ...input, ignoreAreas: [{ x: 0, y: 0, width: 1, height: 1 }] };

  it('passes a pair that is equal only after masking, without counting pixels', async () => {
    const changed = filled(10, 10, 255);
    changed.data[0] = 0;
    const { service } = await initService(filled(10, 10, 255), changed);

    const result = await service.getDiff(ignoreFirstPixel, DEFAULT_CONFIG);

    expect(result).toStrictEqual({
      status: TestStatus.ok,
      diffName: null,
      pixelMisMatchCount: undefined,
      diffPercent: 0,
      isSameDimension: true,
    });
  });

  it('counts zero pixels when only the gamma differs after masking', async () => {
    const baseline = filled(10, 10, 255);
    baseline.gamma = 0.45455;
    const changed = filled(10, 10, 255);
    changed.data[0] = 0;
    const { service } = await initService(baseline, changed);

    const result = await service.getDiff(ignoreFirstPixel, DEFAULT_CONFIG);

    expect(result).toStrictEqual({
      status: TestStatus.ok,
      diffName: null,
      pixelMisMatchCount: 0,
      diffPercent: 0,
      isSameDimension: true,
    });
  });

  it('reports the pixels looks-same counts on the fixtures', async () => {
    const { service } = await fixtures();

    const result = await service.getDiff({ ...input, saveDiffAsFile: false }, DEFAULT_CONFIG);

    expect(result.status).toBe(TestStatus.unresolved);
    expect(result.pixelMisMatchCount).toBe(31068);
    expect(result.diffPercent).toBeCloseTo((31068 * 100) / 129600, 10);
    expect(result.isSameDimension).toBe(true);
  });

  it('counts more pixels in the strict mode without antialiasing and caret handling', async () => {
    const { service } = await fixtures();

    const result = await service.getDiff(
      { ...input, saveDiffAsFile: false },
      { strict: true, ignoreAntialiasing: false, ignoreCaret: false }
    );

    expect(result.pixelMisMatchCount).toBe(33915);
  });

  it('saves the looks-same diff of the fixtures', async () => {
    const { service, saveImage } = await fixtures();

    const result = await service.getDiff(input, DEFAULT_CONFIG);

    expect(result.diffName).toBe('diff.png');
    expect(saveImage).toHaveBeenCalledWith('diff', expect.any(Buffer));
    const diff = PNG.sync.read(saveImage.mock.calls[0][1]);
    expect([diff.width, diff.height]).toEqual([360, 360]);
  });

  it('falls back to the defaults when looks-same refuses the project config', async () => {
    const { service } = await fixtures();

    const result = await service.getDiff(
      { ...input, saveDiffAsFile: false },
      { ...DEFAULT_CONFIG, strict: true, tolerance: 5 }
    );

    expect(result).toStrictEqual({
      status: TestStatus.unresolved,
      diffName: null,
      pixelMisMatchCount: 31068,
      diffPercent: (31068 * 100) / 129600,
      isSameDimension: true,
    });
  });
});
