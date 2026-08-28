import { TestingModule, Test } from '@nestjs/testing';
import { TestStatus } from '@prisma/client';
import Pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { mocked } from 'jest-mock';
import { StaticService } from '../../../static/static.service';
import { DiffWorkerPool } from '../../diff-worker-pool';
import { DIFF_DIMENSION_RESULT, EQUAL_RESULT, NO_BASELINE_RESULT } from '../consts';
import { DEFAULT_CONFIG, PixelmatchService } from './pixelmatch.service';
import { PixelmatchConfig } from './pixelmatch.types';

jest.mock('pixelmatch');

const toBuffer = (png: PNG | undefined): Buffer | undefined => (png ? PNG.sync.write(png) : undefined);

const initService = async ({
  getImageBufferMock = jest.fn(),
  saveImageMock = jest.fn(),
  deleteImageMock = jest.fn(),
}) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PixelmatchService,
      DiffWorkerPool,
      {
        provide: StaticService,
        useValue: {
          getImageBuffer: getImageBufferMock,
          saveImage: saveImageMock,
          deleteImage: deleteImageMock,
        },
      },
    ],
  }).compile();

  return module.get<PixelmatchService>(PixelmatchService);
};

let service: PixelmatchService;

describe('parseConfig', () => {
  it.each<[string, PixelmatchConfig]>([
    [
      '{"threshold":21.2,"ignoreAntialiasing":false,"allowDiffDimensions":true}',
      { threshold: 21.2, ignoreAntialiasing: false, allowDiffDimensions: true },
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

  it('no baseline', async () => {
    const getImageBufferMock = jest.fn().mockReturnValueOnce(undefined).mockReturnValueOnce(toBuffer(image));
    service = await initService({ getImageBufferMock });

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

  it('diff not found', async () => {
    const getImageBufferMock = jest.fn().mockReturnValueOnce(toBuffer(image)).mockReturnValueOnce(toBuffer(image));
    service = await initService({ getImageBufferMock });

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
    const getImageBufferMock = jest.fn().mockReturnValueOnce(toBuffer(baseline)).mockReturnValueOnce(toBuffer(image));
    service = await initService({ getImageBufferMock });

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

  it('diff image dimensions mismatch ALLOWED', async () => {
    const baseline = new PNG({
      width: 1,
      height: 5,
    });
    const image = new PNG({
      width: 2,
      height: 4,
    });
    const getImageBufferMock = jest.fn().mockReturnValueOnce(toBuffer(baseline)).mockReturnValueOnce(toBuffer(image));
    const diffName = 'diff name';
    const saveImageMock = jest.fn().mockReturnValueOnce(diffName);
    mocked(Pixelmatch).mockReturnValueOnce(5);
    service = await initService({ saveImageMock, getImageBufferMock });

    const result = await service.getDiff(
      {
        baseline: 'image',
        image: 'image',
        diffTollerancePercent: 0.1,
        ignoreAreas: [],
        saveDiffAsFile: true,
      },
      {
        allowDiffDimensions: true,
        ignoreAntialiasing: true,
        threshold: 0.1,
      }
    );

    expect(mocked(Pixelmatch)).toHaveBeenCalledWith(
      new PNG({
        width: 2,
        height: 5,
      }).data,
      new PNG({
        width: 2,
        height: 5,
      }).data,
      new PNG({
        width: 2,
        height: 5,
      }).data,
      2,
      5,
      {
        includeAA: true,
        threshold: 0.1,
      }
    );
    expect(saveImageMock).toHaveBeenCalledTimes(1);
    expect(result).toStrictEqual({
      status: TestStatus.unresolved,
      diffName,
      pixelMisMatchCount: 5,
      diffPercent: 50,
      isSameDimension: false,
    });
  });

  it('diff found < tollerance', async () => {
    const baseline = new PNG({
      width: 100,
      height: 100,
    });
    baseline.data[0] = 1;
    const image = new PNG({
      width: 100,
      height: 100,
    });
    const getImageBufferMock = jest.fn().mockReturnValueOnce(toBuffer(baseline)).mockReturnValueOnce(toBuffer(image));
    const saveImageMock = jest.fn();
    service = await initService({ saveImageMock, getImageBufferMock });
    const pixelMisMatchCount = 150;
    mocked(Pixelmatch).mockReturnValueOnce(pixelMisMatchCount);

    const result = await service.getDiff(
      {
        baseline: 'image',
        image: 'image',
        diffTollerancePercent: 2,
        ignoreAreas: [],
        saveDiffAsFile: false,
      },
      DEFAULT_CONFIG
    );

    expect(saveImageMock).toHaveBeenCalledTimes(0);
    expect(result).toStrictEqual({
      status: TestStatus.ok,
      diffName: null,
      pixelMisMatchCount,
      diffPercent: 1.5,
      isSameDimension: true,
    });
  });

  it('diff found > tollerance', async () => {
    const baseline = new PNG({
      width: 100,
      height: 100,
    });
    baseline.data[0] = 1;
    const image = new PNG({
      width: 100,
      height: 100,
    });
    const getImageBufferMock = jest.fn().mockReturnValueOnce(toBuffer(baseline)).mockReturnValueOnce(toBuffer(image));
    const pixelMisMatchCount = 200;
    mocked(Pixelmatch).mockReturnValueOnce(pixelMisMatchCount);
    const diffName = 'diff name';
    const saveImageMock = jest.fn().mockReturnValueOnce(diffName);
    service = await initService({
      saveImageMock,
      getImageBufferMock,
    });

    const result = await service.getDiff(
      {
        baseline: 'image',
        image: 'image',
        diffTollerancePercent: 0.5,
        ignoreAreas: [],
        saveDiffAsFile: true,
      },
      DEFAULT_CONFIG
    );

    expect(saveImageMock).toHaveBeenCalledTimes(1);
    expect(result).toStrictEqual({
      status: TestStatus.unresolved,
      diffName,
      pixelMisMatchCount,
      diffPercent: 2,
      isSameDimension: true,
    });
  });
});
