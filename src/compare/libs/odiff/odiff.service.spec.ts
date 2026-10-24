import { TestingModule, Test } from '@nestjs/testing';
import { TestStatus } from '@prisma/client';
import { IgnoreAreaDto } from '../../../test-runs/dto/ignore-area.dto';
import { StaticService } from '../../../static/static.service';
import { HddService } from '../../../static/hdd/hdd.service';
import { DIFF_DIMENSION_RESULT, EQUAL_RESULT, NO_BASELINE_RESULT } from '../consts';
import { OdiffService, DEFAULT_CONFIG, ignoreAreaToRegionMapper } from './odiff.service';
import { OdiffConfig, OdiffIgnoreRegions } from './odiff.types';
import { compare } from 'odiff-bin';

jest.mock('odiff-bin', () => ({
  compare: jest.fn(),
}));

const compareMock = compare as jest.MockedFunction<typeof compare>;

const initService = async ({
  generateNewImageMock = jest.fn(),
  getImagePathMock = jest.fn(),
  deleteImageMock = jest.fn(),
}) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      OdiffService,
      {
        provide: StaticService,
        useValue: {
          deleteImage: deleteImageMock,
        },
      },
      {
        provide: HddService,
        useValue: {
          generateNewImage: generateNewImageMock,
          getImagePath: getImagePathMock,
        },
      },
    ],
  }).compile();

  return module.get<OdiffService>(OdiffService);
};

let service: OdiffService;

describe('parseConfig', () => {
  it.each<[string, OdiffConfig]>([
    [
      '{"threshold":0,"antialiasing":true,"failOnLayoutDiff":true,"outputDiffMask":true}',
      {
        threshold: 0,
        antialiasing: true,
        failOnLayoutDiff: true,
        outputDiffMask: true,
      },
    ],
    ['', DEFAULT_CONFIG],
    ['invalid', DEFAULT_CONFIG],
  ])('should parse config', async (json, expected) => {
    service = await initService({});

    const config = service.parseConfig(json);

    expect(config).toStrictEqual(expected);
  });
});

describe('getDiff', () => {
  it('no baseline', async () => {
    service = await initService({});

    const result = await service.getDiff(
      {
        baseline: null,
        image: 'image',
        diffTollerancePercent: 0.1,
        ignoreAreas: [],
        saveDiffAsFile: true,
      },
      DEFAULT_CONFIG
    );

    expect(result).toStrictEqual(NO_BASELINE_RESULT);
  });

  it('diff layout', async () => {
    const generateNewImageMock = jest.fn().mockReturnValueOnce({ imagePath: './diff.png', imageName: 'diff.png' });
    const getImagePathMock = jest.fn().mockReturnValueOnce('./baseline.png').mockReturnValueOnce('./image.png');
    const deleteImageMock = jest.fn();
    compareMock.mockResolvedValueOnce({ match: false, reason: 'layout-diff' });
    service = await initService({
      getImagePathMock,
      generateNewImageMock,
      deleteImageMock,
    });

    const result = await service.getDiff(
      {
        baseline: 'baseline',
        image: 'image',
        diffTollerancePercent: 0.1,
        ignoreAreas: [],
        saveDiffAsFile: true,
      },
      {
        ...DEFAULT_CONFIG,
        failOnLayoutDiff: true,
      }
    );

    expect(result).toStrictEqual(DIFF_DIMENSION_RESULT);
    expect(deleteImageMock).not.toHaveBeenCalled();
  });

  it('diff found', async () => {
    const generateNewImageMock = jest.fn().mockReturnValueOnce({ imagePath: './diff.png', imageName: 'diff.png' });
    const getImagePathMock = jest.fn().mockReturnValueOnce('./baseline.png').mockReturnValueOnce('./image.png');
    const deleteImageMock = jest.fn();
    compareMock.mockResolvedValueOnce({ match: false, reason: 'pixel-diff', diffPercentage: 12.34, diffCount: 33.33 });
    service = await initService({
      getImagePathMock,
      generateNewImageMock,
      deleteImageMock,
    });

    const result = await service.getDiff(
      {
        baseline: 'baseline',
        image: 'image',
        diffTollerancePercent: 0.1,
        ignoreAreas: [],
        saveDiffAsFile: true,
      },
      {
        ...DEFAULT_CONFIG,
        failOnLayoutDiff: true,
      }
    );

    expect(deleteImageMock).not.toHaveBeenCalled();
    expect(result).toStrictEqual({
      diffName: 'diff.png',
      diffPercent: 12.34,
      isSameDimension: true,
      pixelMisMatchCount: 33.33,
      status: TestStatus.unresolved,
    });
  });

  it('diff found < tollerance', async () => {
    const generateNewImageMock = jest.fn().mockReturnValueOnce({ imagePath: './diff.png', imageName: 'diff.png' });
    const getImagePathMock = jest.fn().mockReturnValueOnce('./baseline.png').mockReturnValueOnce('./image.png');
    const deleteImageMock = jest.fn();
    compareMock.mockResolvedValueOnce({ match: false, reason: 'pixel-diff', diffPercentage: 0.05, diffCount: 33.33 });
    service = await initService({
      getImagePathMock,
      generateNewImageMock,
      deleteImageMock,
    });

    const result = await service.getDiff(
      {
        baseline: 'baseline',
        image: 'image',
        diffTollerancePercent: 0.1,
        ignoreAreas: [],
        saveDiffAsFile: true,
      },
      DEFAULT_CONFIG
    );

    // odiff writes the diff image for every pixel diff, so one below the tolerance is not kept
    expect(deleteImageMock).toHaveBeenCalledWith('diff.png');
    expect(result).toStrictEqual({
      diffName: null,
      diffPercent: 0.05,
      isSameDimension: true,
      pixelMisMatchCount: 33.33,
      status: TestStatus.ok,
    });
  });

  it('diff found no save', async () => {
    const generateNewImageMock = jest.fn().mockReturnValueOnce({ imagePath: './diff.png', imageName: 'diff.png' });
    const getImagePathMock = jest.fn().mockReturnValueOnce('./baseline.png').mockReturnValueOnce('./image.png');
    const deleteImageMock = jest.fn();
    compareMock.mockResolvedValueOnce({ match: false, reason: 'pixel-diff', diffPercentage: 3, diffCount: 33.33 });
    service = await initService({
      getImagePathMock,
      generateNewImageMock,
      deleteImageMock,
    });

    const result = await service.getDiff(
      {
        baseline: 'baseline',
        image: 'image',
        diffTollerancePercent: 0.1,
        ignoreAreas: [],
        saveDiffAsFile: false,
      },
      DEFAULT_CONFIG
    );

    expect(deleteImageMock).toHaveBeenCalledWith('diff.png');
    expect(result).toStrictEqual({
      diffName: null,
      diffPercent: 3,
      isSameDimension: true,
      pixelMisMatchCount: 33.33,
      status: TestStatus.unresolved,
    });
  });

  it('passes ignore areas to odiff as regions', async () => {
    const generateNewImageMock = jest.fn().mockReturnValueOnce({ imagePath: './diff.png', imageName: 'diff.png' });
    const getImagePathMock = jest.fn().mockReturnValueOnce('./baseline.png').mockReturnValueOnce('./image.png');
    compareMock.mockResolvedValueOnce({ match: true });
    service = await initService({
      getImagePathMock,
      generateNewImageMock,
    });

    await service.getDiff(
      {
        baseline: 'baseline',
        image: 'image',
        diffTollerancePercent: 0.1,
        ignoreAreas: [{ x: 1, y: 2, width: 3, height: 4 }],
        saveDiffAsFile: true,
      },
      DEFAULT_CONFIG
    );

    expect(compareMock).toHaveBeenLastCalledWith('./baseline.png', './image.png', './diff.png', {
      ...DEFAULT_CONFIG,
      diffColor: '#cd2cc9',
      noFailOnFsErrors: true,
      ignoreRegions: [{ x1: 1, y1: 2, x2: 4, y2: 6 }],
    });
  });

  it('does not pass empty ignore regions to odiff', async () => {
    // odiff 4 rejects an empty --ignore= argument with "Invalid ignore regions format"
    const generateNewImageMock = jest.fn().mockReturnValueOnce({ imagePath: './diff.png', imageName: 'diff.png' });
    const getImagePathMock = jest.fn().mockReturnValueOnce('./baseline.png').mockReturnValueOnce('./image.png');
    compareMock.mockResolvedValueOnce({ match: true });
    service = await initService({
      getImagePathMock,
      generateNewImageMock,
    });

    await service.getDiff(
      {
        baseline: 'baseline',
        image: 'image',
        diffTollerancePercent: 0.1,
        ignoreAreas: [],
        saveDiffAsFile: true,
      },
      DEFAULT_CONFIG
    );

    expect(compareMock.mock.lastCall![3]).not.toHaveProperty('ignoreRegions');
  });

  it('ok', async () => {
    const generateNewImageMock = jest.fn().mockReturnValueOnce({ imagePath: './diff.png', imageName: 'diff.png' });
    const getImagePathMock = jest.fn().mockReturnValueOnce('./baseline.png').mockReturnValueOnce('./image.png');
    const deleteImageMock = jest.fn();
    compareMock.mockResolvedValueOnce({ match: true });
    service = await initService({
      getImagePathMock,
      generateNewImageMock,
      deleteImageMock,
    });

    const result = await service.getDiff(
      {
        baseline: 'baseline',
        image: 'image',
        diffTollerancePercent: 0.1,
        ignoreAreas: [],
        saveDiffAsFile: false,
      },
      DEFAULT_CONFIG
    );

    // odiff writes no diff image when the images match
    expect(deleteImageMock).not.toHaveBeenCalled();
    expect(result).toStrictEqual(EQUAL_RESULT);
  });

  it('diff found without parsable numbers', async () => {
    // odiff-bin resolves a pixel diff without numbers when it cannot parse the binary output
    const generateNewImageMock = jest.fn().mockReturnValueOnce({ imagePath: './diff.png', imageName: 'diff.png' });
    const getImagePathMock = jest.fn().mockReturnValueOnce('./baseline.png').mockReturnValueOnce('./image.png');
    compareMock.mockResolvedValueOnce({ match: false, reason: 'pixel-diff' } as Awaited<ReturnType<typeof compare>>);
    service = await initService({
      getImagePathMock,
      generateNewImageMock,
    });

    const result = await service.getDiff(
      {
        baseline: 'baseline',
        image: 'image',
        diffTollerancePercent: 0.1,
        ignoreAreas: [],
        saveDiffAsFile: true,
      },
      DEFAULT_CONFIG
    );

    expect(result).toStrictEqual({
      diffName: 'diff.png',
      diffPercent: undefined,
      isSameDimension: true,
      pixelMisMatchCount: undefined,
      status: TestStatus.unresolved,
    });
  });

  it('baseline file missing', async () => {
    const generateNewImageMock = jest.fn().mockReturnValueOnce({ imagePath: './diff.png', imageName: 'diff.png' });
    const getImagePathMock = jest.fn().mockReturnValueOnce('./baseline.png').mockReturnValueOnce('./image.png');
    compareMock.mockResolvedValueOnce({ match: false, reason: 'file-not-exists', file: './baseline.png' });
    service = await initService({
      getImagePathMock,
      generateNewImageMock,
    });

    const result = await service.getDiff(
      {
        baseline: 'baseline',
        image: 'image',
        diffTollerancePercent: 0.1,
        ignoreAreas: [],
        saveDiffAsFile: true,
      },
      DEFAULT_CONFIG
    );

    expect(result).toStrictEqual(NO_BASELINE_RESULT);
  });

  it('image file missing', async () => {
    const generateNewImageMock = jest.fn().mockReturnValueOnce({ imagePath: './diff.png', imageName: 'diff.png' });
    const getImagePathMock = jest.fn().mockReturnValueOnce('./baseline.png').mockReturnValueOnce('./image.png');
    compareMock.mockResolvedValueOnce({ match: false, reason: 'file-not-exists', file: './image.png' });
    service = await initService({
      getImagePathMock,
      generateNewImageMock,
    });

    await expect(
      service.getDiff(
        {
          baseline: 'baseline',
          image: 'image',
          diffTollerancePercent: 0.1,
          ignoreAreas: [],
          saveDiffAsFile: true,
        },
        DEFAULT_CONFIG
      )
    ).rejects.toThrow('Cannot get image: image');
  });

  it('odiff error', async () => {
    const generateNewImageMock = jest.fn().mockReturnValueOnce({ imagePath: './diff.png', imageName: 'diff.png' });
    const getImagePathMock = jest.fn().mockReturnValueOnce('./baseline.png').mockReturnValueOnce('./image.png');
    compareMock.mockRejectedValueOnce(new TypeError('Error: Could not load comparison image: ./image.png'));
    service = await initService({
      getImagePathMock,
      generateNewImageMock,
    });

    await expect(
      service.getDiff(
        {
          baseline: 'baseline',
          image: 'image',
          diffTollerancePercent: 0.1,
          ignoreAreas: [],
          saveDiffAsFile: true,
        },
        DEFAULT_CONFIG
      )
    ).rejects.toThrow('Could not load comparison image');
  });
});

it.each<[IgnoreAreaDto[], OdiffIgnoreRegions]>([
  [[], []],
  [
    [
      {
        x: 1,
        y: 2,
        width: 3,
        height: 4,
      },
    ],
    [
      {
        x1: 1,
        y1: 2,
        x2: 4,
        y2: 6,
      },
    ],
  ],
])('ignoreAreaToRegionMapper', async (ignoreAreas, ignoreRegions) => {
  const result = ignoreAreaToRegionMapper(ignoreAreas);

  expect(result).toStrictEqual(ignoreRegions);
});
