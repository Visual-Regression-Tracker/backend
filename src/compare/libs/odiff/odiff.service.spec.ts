import { Test } from '@nestjs/testing';
import { TestStatus } from '@prisma/client';
import { IgnoreAreaDto } from '../../../test-runs/dto/ignore-area.dto';
import { StaticService } from '../../../static/static.service';
import { HddService } from '../../../static/hdd/hdd.service';
import { DIFF_DIMENSION_RESULT, EQUAL_RESULT, NO_BASELINE_RESULT } from '../consts';
import { ImageCompareInput } from '../ImageCompareInput';
import { OdiffService, DEFAULT_CONFIG, ignoreAreaToRegionMapper } from './odiff.service';
import { OdiffConfig, OdiffIgnoreRegions } from './odiff.types';
import { compare } from 'odiff-bin';

jest.mock('odiff-bin', () => ({
  compare: jest.fn(),
}));

type CompareResult = Awaited<ReturnType<typeof compare>>;

const compareMock = compare as jest.MockedFunction<typeof compare>;

const setup = async (compareResult?: CompareResult) => {
  if (compareResult) {
    compareMock.mockResolvedValueOnce(compareResult);
  }
  const deleteImage = jest.fn();
  const module = await Test.createTestingModule({
    providers: [
      OdiffService,
      { provide: StaticService, useValue: { deleteImage } },
      {
        provide: HddService,
        useValue: {
          generateNewImage: jest.fn().mockReturnValueOnce({ imagePath: './diff.png', imageName: 'diff.png' }),
          getImagePath: jest.fn().mockReturnValueOnce('./baseline.png').mockReturnValueOnce('./image.png'),
        },
      },
    ],
  }).compile();
  return { service: module.get(OdiffService), deleteImage };
};

const input: ImageCompareInput = {
  baseline: 'baseline',
  image: 'image',
  diffTollerancePercent: 0.1,
  ignoreAreas: [],
  saveDiffAsFile: true,
};

const pixelDiff = (diffPercentage: number, diffCount = 33.33) =>
  ({ match: false, reason: 'pixel-diff', diffPercentage, diffCount }) as CompareResult;

const verdict = (status: TestStatus, diffName: string | null, diffPercent: number | undefined, count = 33.33) => ({
  diffName,
  diffPercent,
  isSameDimension: true,
  pixelMisMatchCount: diffPercent === undefined ? undefined : count,
  status,
});

describe('parseConfig', () => {
  it.each<[string, OdiffConfig]>([
    [
      '{"threshold":0,"antialiasing":true,"failOnLayoutDiff":true,"outputDiffMask":true}',
      { threshold: 0, antialiasing: true, failOnLayoutDiff: true, outputDiffMask: true },
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
    const { service } = await setup();

    expect(await service.getDiff({ ...input, baseline: null }, DEFAULT_CONFIG)).toStrictEqual(NO_BASELINE_RESULT);
  });

  it('diff layout', async () => {
    const { service, deleteImage } = await setup({ match: false, reason: 'layout-diff' });

    const result = await service.getDiff(input, { ...DEFAULT_CONFIG, failOnLayoutDiff: true });

    expect(result).toStrictEqual(DIFF_DIMENSION_RESULT);
    expect(deleteImage).not.toHaveBeenCalled();
  });

  it('diff found', async () => {
    const { service, deleteImage } = await setup(pixelDiff(12.34));

    const result = await service.getDiff(input, { ...DEFAULT_CONFIG, failOnLayoutDiff: true });

    expect(deleteImage).not.toHaveBeenCalled();
    expect(result).toStrictEqual(verdict(TestStatus.unresolved, 'diff.png', 12.34));
  });

  it('diff found < tollerance', async () => {
    const { service, deleteImage } = await setup(pixelDiff(0.05));

    const result = await service.getDiff(input, DEFAULT_CONFIG);

    expect(deleteImage).toHaveBeenCalledWith('diff.png');
    expect(result).toStrictEqual(verdict(TestStatus.ok, null, 0.05));
  });

  it('diff found no save', async () => {
    const { service, deleteImage } = await setup(pixelDiff(3));

    const result = await service.getDiff({ ...input, saveDiffAsFile: false }, DEFAULT_CONFIG);

    expect(deleteImage).toHaveBeenCalledWith('diff.png');
    expect(result).toStrictEqual(verdict(TestStatus.unresolved, null, 3));
  });

  it('passes ignore areas to odiff as regions', async () => {
    const { service } = await setup({ match: true });

    await service.getDiff({ ...input, ignoreAreas: [{ x: 1, y: 2, width: 3, height: 4 }] }, DEFAULT_CONFIG);

    expect(compareMock).toHaveBeenLastCalledWith('./baseline.png', './image.png', './diff.png', {
      ...DEFAULT_CONFIG,
      diffColor: '#cd2cc9',
      noFailOnFsErrors: true,
      ignoreRegions: [{ x1: 1, y1: 2, x2: 4, y2: 6 }],
    });
  });

  it.each([
    ['there are none', []],
    ['every area lies outside the image', [{ x: -20, y: 0, width: 10, height: 5 }]],
  ])('does not pass ignore regions when %s', async (_, ignoreAreas) => {
    const { service } = await setup({ match: true });

    await service.getDiff({ ...input, ignoreAreas }, DEFAULT_CONFIG);

    expect(compareMock.mock.lastCall![3]).not.toHaveProperty('ignoreRegions');
  });

  it('ok', async () => {
    const { service, deleteImage } = await setup({ match: true });

    const result = await service.getDiff({ ...input, saveDiffAsFile: false }, DEFAULT_CONFIG);

    expect(deleteImage).not.toHaveBeenCalled();
    expect(result).toStrictEqual(EQUAL_RESULT);
  });

  it('diff found without parsable numbers', async () => {
    const { service } = await setup({ match: false, reason: 'pixel-diff' } as CompareResult);

    const result = await service.getDiff(input, DEFAULT_CONFIG);

    expect(result).toStrictEqual(verdict(TestStatus.unresolved, 'diff.png', undefined));
  });

  it('baseline file missing', async () => {
    const { service } = await setup({ match: false, reason: 'file-not-exists', file: './baseline.png' });

    expect(await service.getDiff(input, DEFAULT_CONFIG)).toStrictEqual(NO_BASELINE_RESULT);
  });

  it('image file missing', async () => {
    const { service } = await setup({ match: false, reason: 'file-not-exists', file: './image.png' });

    await expect(service.getDiff(input, DEFAULT_CONFIG)).rejects.toThrow('Cannot get image: image');
  });

  it('odiff error', async () => {
    const { service } = await setup();
    compareMock.mockRejectedValueOnce(new TypeError('Error: Could not load comparison image: ./image.png'));

    await expect(service.getDiff(input, DEFAULT_CONFIG)).rejects.toThrow('Could not load comparison image');
  });
});

it.each<[IgnoreAreaDto[], OdiffIgnoreRegions]>([
  [[], []],
  [[{ x: 1, y: 2, width: 3, height: 4 }], [{ x1: 1, y1: 2, x2: 4, y2: 6 }]],
  [[{ x: 1.5, y: 2.2, width: 3, height: 4 }], [{ x1: 1, y1: 2, x2: 5, y2: 7 }]],
  [[{ x: -5, y: -1, width: 10, height: 3 }], [{ x1: 0, y1: 0, x2: 5, y2: 2 }]],
  [[{ x: -20, y: 0, width: 10, height: 5 }], []],
  [[{ x: 10, y: 10, width: 0, height: 5 }], [{ x1: 10, y1: 10, x2: 10, y2: 15 }]],
])('ignoreAreaToRegionMapper', async (ignoreAreas, ignoreRegions) => {
  expect(ignoreAreaToRegionMapper(ignoreAreas)).toStrictEqual(ignoreRegions);
});
