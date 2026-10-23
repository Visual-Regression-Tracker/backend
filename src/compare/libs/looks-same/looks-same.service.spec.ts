import { TestingModule, Test } from '@nestjs/testing';
import { TestStatus } from '@prisma/client';
import { PNG } from 'pngjs';
import { StaticService } from '../../../static/static.service';
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

  const input = {
    baseline: 'image',
    image: 'image',
    diffTollerancePercent: 0.1,
    ignoreAreas: [],
  };

  it('diff not found', async () => {
    const getImageMock = jest.fn().mockReturnValueOnce(image).mockReturnValueOnce(anotherImage);
    service = await initService({ getImageMock });
    service.compare = jest.fn().mockReturnValueOnce({ equal: true, differentPixels: 0, totalPixels: 400 });

    const result = await service.getDiff({ ...input, saveDiffAsFile: true }, DEFAULT_CONFIG);

    expect(result).toStrictEqual({
      status: TestStatus.ok,
      diffName: null,
      diffPercent: 0,
      pixelMisMatchCount: 0,
      isSameDimension: true,
    });
  });

  it('diff found', async () => {
    const getImageMock = jest.fn().mockReturnValueOnce(image).mockReturnValueOnce(anotherImage);
    service = await initService({ getImageMock });
    service.compare = jest.fn().mockReturnValueOnce({ equal: false, differentPixels: 20, totalPixels: 400 });
    service.saveDiff = jest.fn();

    const result = await service.getDiff({ ...input, saveDiffAsFile: false }, DEFAULT_CONFIG);

    expect(service.compare).toHaveBeenCalledWith(image, anotherImage, DEFAULT_CONFIG);
    expect(service.saveDiff).not.toHaveBeenCalled();
    expect(result).toStrictEqual({
      status: TestStatus.unresolved,
      diffName: null,
      diffPercent: 5,
      pixelMisMatchCount: 20,
      isSameDimension: true,
    });
  });

  it('diff found and save diff', async () => {
    const diffImage = { createBuffer: jest.fn() };
    const getImageMock = jest.fn().mockReturnValueOnce(image).mockReturnValueOnce(anotherImage);
    service = await initService({ getImageMock });
    service.compare = jest.fn().mockReturnValueOnce({ equal: false, differentPixels: 20, totalPixels: 400, diffImage });
    service.saveDiff = jest.fn().mockReturnValueOnce('diff name');

    const result = await service.getDiff({ ...input, saveDiffAsFile: true }, DEFAULT_CONFIG);

    expect(service.compare).toHaveBeenCalledWith(image, anotherImage, DEFAULT_CONFIG);
    expect(service.saveDiff).toHaveBeenCalledWith(diffImage);
    expect(result).toStrictEqual({
      status: TestStatus.unresolved,
      diffName: 'diff name',
      diffPercent: 5,
      pixelMisMatchCount: 20,
      isSameDimension: true,
    });
  });

  it('comparison failed', async () => {
    const getImageMock = jest.fn().mockReturnValueOnce(image).mockReturnValueOnce(anotherImage);
    service = await initService({ getImageMock });
    service.compare = jest.fn().mockReturnValueOnce(undefined);

    const result = await service.getDiff({ ...input, saveDiffAsFile: true }, DEFAULT_CONFIG);

    expect(result).toStrictEqual({
      status: TestStatus.unresolved,
      diffName: null,
      diffPercent: undefined,
      pixelMisMatchCount: undefined,
      isSameDimension: true,
    });
  });

  it('saves the Looks-Same diff with its metrics', async () => {
    const baseline = new PNG({ width: 2, height: 1 });
    const changed = new PNG({ width: 2, height: 1 });
    baseline.data.fill(255);
    changed.data.fill(255);
    changed.data[0] = 0;
    const getImageMock = jest.fn().mockReturnValueOnce(baseline).mockReturnValueOnce(changed);
    const saveImageMock = jest.fn().mockReturnValueOnce('diff name');
    service = await initService({ getImageMock, saveImageMock });

    const result = await service.getDiff(
      { ...input, saveDiffAsFile: true },
      { ...DEFAULT_CONFIG, strict: true, ignoreAntialiasing: false }
    );

    expect(result).toStrictEqual({
      status: TestStatus.unresolved,
      diffName: 'diff name',
      diffPercent: 50,
      pixelMisMatchCount: 1,
      isSameDimension: true,
    });
    expect(saveImageMock).toHaveBeenCalledWith('diff', expect.any(Buffer));
  });
});

describe('compare', () => {
  it('returns undefined when Looks-Same fails', async () => {
    service = await initService({});
    const broken = new PNG({ width: 1, height: 1 });
    jest.spyOn(PNG.sync, 'write').mockImplementationOnce(() => Buffer.from('not a png'));

    const result = await service.compare(broken, broken, DEFAULT_CONFIG);

    expect(result).toBeUndefined();
  });
});

describe('saveDiff', () => {
  it('returns null when the diff cannot be saved', async () => {
    const saveImageMock = jest.fn().mockRejectedValueOnce(new Error('disk full'));
    service = await initService({ saveImageMock });
    const diffImage = { createBuffer: jest.fn().mockResolvedValueOnce(Buffer.from('png')) };

    const result = await service.saveDiff(diffImage as never);

    expect(result).toBeNull();
  });
});
