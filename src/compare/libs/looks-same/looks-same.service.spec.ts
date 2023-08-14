import { TestingModule, Test } from '@nestjs/testing';
import { TestStatus } from '@prisma/client';
import { PNG } from 'pngjs';
import { StaticService } from '../../../shared/static/static.service';
import { DIFF_DIMENSION_RESULT, EQUAL_RESULT, NO_BASELINE_RESULT } from '../consts';
import { DEFAULT_CONFIG, LookSameService } from './looks-same.service';
import { LooksSameConfig } from './looks-same.types';

const initService = async ({ getImageMock = jest.fn(), saveImageMock = jest.fn(), deleteImageMock = jest.fn() }) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      LookSameService,
      {
        provide: StaticService,
        useValue: {
          getImage: getImageMock,
          saveImage: saveImageMock,
          deleteImage: deleteImageMock,
        },
      },
    ],
  }).compile();

  return module.get<LookSameService>(LookSameService);
};

let service: LookSameService;

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
    service = await initService({});

    const config = service.parseConfig(json);

    expect(config).toStrictEqual(expected);
  });
});

describe('getDiff', () => {
  const image = new PNG({
    width: 20,
    height: 20,
  });
  const anotherImage = new PNG({
    width: 20,
    height: 20,
  });
  anotherImage.data[0] = 1; // alterate pixel to have it different from 0

  it('no baseline', async () => {
    const getImageMock = jest.fn().mockReturnValueOnce(undefined).mockReturnValueOnce(image);
    service = await initService({ getImageMock });

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

  it('equal images', async () => {
    const getImageMock = jest.fn().mockReturnValueOnce(image).mockReturnValueOnce(image);
    service = await initService({ getImageMock });

    const result = await service.getDiff(
      {
        baseline: 'image',
        image: 'image',
        diffTollerancePercent: 0.1,
        ignoreAreas: [],
        saveDiffAsFile: true,
      },
      DEFAULT_CONFIG
    );

    expect(result).toStrictEqual(EQUAL_RESULT);
  });

  it('diff image dimensions mismatch', async () => {
    const baseline = new PNG({
      width: 10,
      height: 10,
    });
    const getImageMock = jest.fn().mockReturnValueOnce(image).mockReturnValueOnce(baseline);
    service = await initService({ getImageMock });

    const result = await service.getDiff(
      {
        baseline: 'image',
        image: 'image',
        diffTollerancePercent: 0.1,
        ignoreAreas: [],
        saveDiffAsFile: true,
      },
      DEFAULT_CONFIG
    );

    expect(result).toStrictEqual(DIFF_DIMENSION_RESULT);
  });

  it('diff not found', async () => {
    const getImageMock = jest.fn().mockReturnValueOnce(image).mockReturnValueOnce(anotherImage);
    service = await initService({ getImageMock });
    service.compare = jest.fn().mockReturnValueOnce({ equal: true });

    const result = await service.getDiff(
      {
        baseline: 'image',
        image: 'image',
        diffTollerancePercent: 0.1,
        ignoreAreas: [],
        saveDiffAsFile: true,
      },
      DEFAULT_CONFIG
    );

    expect(result).toStrictEqual({
      status: TestStatus.ok,
      diffName: null,
      diffPercent: undefined,
      pixelMisMatchCount: undefined,
      isSameDimension: true,
    });
  });

  it('diff found', async () => {
    const getImageMock = jest.fn().mockReturnValueOnce(image).mockReturnValueOnce(anotherImage);
    service = await initService({ getImageMock });
    service.compare = jest.fn().mockReturnValueOnce({ equal: false });

    const result = await service.getDiff(
      {
        baseline: 'image',
        image: 'image',
        diffTollerancePercent: 0.1,
        ignoreAreas: [],
        saveDiffAsFile: false,
      },
      DEFAULT_CONFIG
    );

    expect(service.compare).toHaveBeenCalledWith(image, anotherImage, DEFAULT_CONFIG);
    expect(result).toStrictEqual({
      status: TestStatus.unresolved,
      diffName: null,
      diffPercent: undefined,
      pixelMisMatchCount: undefined,
      isSameDimension: true,
    });
  });

  it('diff found and save diff', async () => {
    const getImageMock = jest.fn().mockReturnValueOnce(image).mockReturnValueOnce(anotherImage);
    service = await initService({ getImageMock });
    service.compare = jest.fn().mockReturnValueOnce({ equal: false });
    service.createDiff = jest.fn().mockReturnValueOnce('diff name');

    const result = await service.getDiff(
      {
        baseline: 'image',
        image: 'image',
        diffTollerancePercent: 0.1,
        ignoreAreas: [],
        saveDiffAsFile: true,
      },
      DEFAULT_CONFIG
    );

    expect(service.compare).toHaveBeenCalledWith(image, anotherImage, DEFAULT_CONFIG);
    expect(service.createDiff).toHaveBeenCalledWith(image, anotherImage, DEFAULT_CONFIG);
    expect(result).toStrictEqual({
      status: TestStatus.unresolved,
      diffName: 'diff name',
      diffPercent: undefined,
      pixelMisMatchCount: undefined,
      isSameDimension: true,
    });
  });
});
