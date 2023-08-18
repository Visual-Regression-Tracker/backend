import { TestingModule, Test } from '@nestjs/testing';
import { TestStatus } from '@prisma/client';
import { IgnoreAreaDto } from 'src/test-runs/dto/ignore-area.dto';
import { StaticService } from '../../../shared/static/static.service';
import { DIFF_DIMENSION_RESULT, NO_BASELINE_RESULT } from '../consts';
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
    compareMock.mockResolvedValueOnce({ match: false, reason: 'layout-diff' });
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
      {
        ...DEFAULT_CONFIG,
        failOnLayoutDiff: true,
      }
    );

    expect(result).toStrictEqual(DIFF_DIMENSION_RESULT);
  });

  it('diff found', async () => {
    const generateNewImageMock = jest.fn().mockReturnValueOnce({ imagePath: './diff.png', imageName: 'diff.png' });
    const getImagePathMock = jest.fn().mockReturnValueOnce('./baseline.png').mockReturnValueOnce('./image.png');
    compareMock.mockResolvedValueOnce({ match: false, reason: 'pixel-diff', diffPercentage: 12.34, diffCount: 33.33 });
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
      {
        ...DEFAULT_CONFIG,
        failOnLayoutDiff: true,
      }
    );

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
    compareMock.mockResolvedValueOnce({ match: false, reason: 'pixel-diff', diffPercentage: 0.05, diffCount: 33.33 });
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

    expect(deleteImageMock).toHaveBeenLastCalledWith('./diff.png');
    expect(result).toStrictEqual({
      diffName: null,
      diffPercent: 3,
      isSameDimension: true,
      pixelMisMatchCount: 33.33,
      status: TestStatus.unresolved,
    });
  });

  it('ok', async () => {
    const generateNewImageMock = jest.fn().mockReturnValueOnce({ imagePath: './diff.png', imageName: 'diff.png' });
    const getImagePathMock = jest.fn().mockReturnValueOnce('./baseline.png').mockReturnValueOnce('./image.png');
    compareMock.mockResolvedValueOnce({ match: true });
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
        saveDiffAsFile: false,
      },
      DEFAULT_CONFIG
    );

    expect(result).toStrictEqual({
      diffName: null,
      diffPercent: 0,
      isSameDimension: true,
      pixelMisMatchCount: 0,
      status: TestStatus.ok,
    });
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
