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
import { Dinov2Service } from '../dinov2/dinov2.service';

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
      { provide: Dinov2Service, useValue: { confirmsNoise: jest.fn() } },
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
    ['null', DEFAULT_CONFIG],
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

  it('throws when the image cannot be read', async () => {
    const getImageBufferMock = jest.fn().mockResolvedValueOnce(toBuffer(image)).mockResolvedValueOnce(undefined);
    service = await initService({ getImageBufferMock });

    await expect(
      service.getDiff(
        {
          baseline: 'baseline',
          image: 'missing.png',
          diffTollerancePercent: 0.1,
          ignoreAreas: [],
          saveDiffAsFile: true,
        },
        DEFAULT_CONFIG
      )
    ).rejects.toThrow('Cannot get image: missing.png');
    expect(getImageBufferMock).toHaveBeenNthCalledWith(2, 'missing.png');
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
    // the full-size diff first, then the two thumbnails made beside it
    expect(saveImageMock.mock.calls[0][0]).toBe('diff');
    expect(saveImageMock).toHaveBeenCalledTimes(3);
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

    // the full-size diff first, then the two thumbnails made beside it
    expect(saveImageMock.mock.calls[0][0]).toBe('diff');
    expect(saveImageMock).toHaveBeenCalledTimes(3);
    expect(result).toStrictEqual({
      status: TestStatus.unresolved,
      diffName,
      pixelMisMatchCount,
      diffPercent: 2,
      isSameDimension: true,
    });
  });
});

describe('change signature', () => {
  // Correctness of the signature itself is pinned in pixelmatch.core.spec
  // against the real pixelmatch; Pixelmatch is mocked in this file, so what is
  // worth testing here is only the plumbing — that the service asks for one and
  // carries what comes back into the result.
  const initWithPool = async (output: Record<string, unknown>) => {
    const run = jest.fn().mockResolvedValue(output);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PixelmatchService,
        { provide: DiffWorkerPool, useValue: { run } },
        { provide: Dinov2Service, useValue: { confirmsNoise: jest.fn() } },
        {
          provide: StaticService,
          useValue: {
            getImageBuffer: jest.fn().mockResolvedValue(Buffer.from('png')),
            saveImage: jest.fn(),
            deleteImage: jest.fn(),
          },
        },
      ],
    }).compile();
    return { service: module.get<PixelmatchService>(PixelmatchService), run };
  };

  const compare = (service: PixelmatchService, saveDiffAsFile = false) =>
    service.getDiff(
      {
        baseline: 'baseline.png',
        image: 'image.png',
        ignoreAreas: [],
        diffTollerancePercent: 0,
        saveDiffAsFile,
      },
      DEFAULT_CONFIG
    );

  // Asked for on every comparison, not only when the project has bulk approve
  // switched on: computing it lazily would leave every run ingested before the
  // flag was turned on without one.
  it('asks for a signature and carries it into the result', async () => {
    const { service, run } = await initWithPool({
      equal: false,
      isSameDimension: true,
      pixelMisMatchCount: 10,
      diffPercent: 5,
      signature: [0.25, 0.75],
    });

    const result = await compare(service);

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ kind: 'diff', withSignature: true }));
    // stamped with the settings it was computed under, so a stored one can be
    // discarded when the project's config moves on
    expect(result.changeSignature).toEqual({
      threshold: DEFAULT_CONFIG.threshold,
      includeAA: DEFAULT_CONFIG.ignoreAntialiasing,
      signature: [0.25, 0.75],
    });
  });

  const initSaving = async (output: Record<string, unknown>) => {
    const saveImage = jest
      .fn()
      .mockResolvedValueOnce('diff.png')
      .mockResolvedValueOnce('image.thumb.png')
      .mockResolvedValueOnce('diff.thumb.png');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PixelmatchService,
        { provide: DiffWorkerPool, useValue: { run: jest.fn().mockResolvedValue(output) } },
        { provide: Dinov2Service, useValue: { confirmsNoise: jest.fn() } },
        {
          provide: StaticService,
          useValue: {
            getImageBuffer: jest.fn().mockResolvedValue(Buffer.from('png')),
            saveImage,
            deleteImage: jest.fn(),
          },
        },
      ],
    }).compile();
    return { service: module.get<PixelmatchService>(PixelmatchService), saveImage };
  };

  const overTolerance = {
    equal: false,
    isSameDimension: true,
    pixelMisMatchCount: 10,
    diffPercent: 5,
    imageThumbnail: Buffer.from('small image'),
    diffThumbnail: Buffer.from('small diff'),
  };

  it('saves the thumbnails and reports the names they went under', async () => {
    const { service } = await initSaving({ ...overTolerance, diffBuffer: Buffer.from('the diff') });

    const result = await compare(service, true);

    expect(result.imageThumbnailName).toBe('image.thumb.png');
    expect(result.diffThumbnailName).toBe('diff.thumb.png');
  });

  // shouldAutoApprove compares against past baselines with saveDiffAsFile off
  // and throws the result away. Storing thumbnails for those comparisons would
  // leave two objects per attempt that nothing ever references or deletes.
  it('stores nothing when the caller is not keeping the diff', async () => {
    const { service, saveImage } = await initSaving(overTolerance);

    const result = await compare(service, false);

    expect(saveImage).not.toHaveBeenCalled();
    expect(result.imageThumbnailName).toBeUndefined();
    expect(result.diffThumbnailName).toBeUndefined();
  });

  it('leaves it out when the comparison produced none', async () => {
    const { service } = await initWithPool({
      equal: false,
      isSameDimension: true,
      pixelMisMatchCount: 10,
      diffPercent: 5,
    });

    expect((await compare(service)).changeSignature).toBeUndefined();
  });
});

describe('blur-amplitude filter', () => {
  // The filter itself is pinned in pixelmatch.core.spec and
  // blur-amplitude.core.spec, and whether a project has it on is
  // CompareService's business; here only the plumbing: what the service asks
  // the worker for, and what it makes of the answer.
  const init = async (output: Record<string, unknown>, confirmsNoise = jest.fn()) => {
    const run = jest.fn().mockResolvedValue(output);
    const saveImage = jest.fn().mockResolvedValue('diff.png');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PixelmatchService,
        { provide: DiffWorkerPool, useValue: { run } },
        { provide: Dinov2Service, useValue: { confirmsNoise } },
        {
          provide: StaticService,
          useValue: {
            getImageBuffer: jest.fn().mockResolvedValue(Buffer.from('png')),
            saveImage,
            deleteImage: jest.fn(),
          },
        },
      ],
    }).compile();
    return { service: module.get<PixelmatchService>(PixelmatchService), run, saveImage, confirmsNoise };
  };

  const filter: { sigma: number; threshold: number; dinov2?: { threshold: number } } = { sigma: 1, threshold: 80 };
  const compare = (service: PixelmatchService, blurAmplitude?: typeof filter) =>
    service.getDiff(
      {
        baseline: 'baseline.png',
        image: 'image.png',
        ignoreAreas: [],
        diffTollerancePercent: 0,
        saveDiffAsFile: true,
        ...(blurAmplitude ? { blurAmplitude } : {}),
      },
      DEFAULT_CONFIG
    );

  const overTolerance = { equal: false, isSameDimension: true, pixelMisMatchCount: 10, diffPercent: 5 };

  // so CompareService does not measure the same pair a second time
  it('applies the filter itself', async () => {
    const { service } = await init(overTolerance);

    expect(service.appliesBlurAmplitudeFilter).toBe(true);
  });

  it('asks for no measurement when the comparison does not carry the filter', async () => {
    const { service, run } = await init(overTolerance);

    await compare(service);

    expect(run.mock.calls[0][0].blurAmplitude).toBeUndefined();
  });

  it('measures with the settings the comparison carries', async () => {
    const { service, run } = await init(overTolerance);

    await compare(service, { sigma: 2, threshold: 50 });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ blurAmplitude: { sigma: 2, threshold: 50 } }));
  });

  // the measured mismatch stays on the run, so a reviewer can still see the
  // pixels moved; only the verdict changes
  it('passes a run whose change is only rendering noise', async () => {
    const { service, saveImage } = await init({ ...overTolerance, blurAmplitude: 40, renderingNoiseOnly: true });

    const result = await compare(service, filter);

    expect(result.status).toBe(TestStatus.ok);
    expect(result.diffPercent).toBe(5);
    expect(result.diffName).toBeNull();
    expect(saveImage).not.toHaveBeenCalled();
  });

  it('fails a run whose change is stronger than rendering noise', async () => {
    const { service } = await init({
      ...overTolerance,
      blurAmplitude: 200,
      renderingNoiseOnly: false,
      diffBuffer: Buffer.from('the diff'),
    });

    const result = await compare(service, filter);

    expect(result.status).toBe(TestStatus.unresolved);
    expect(result.diffName).toBe('diff.png');
  });

  describe('with the DINOv2 check', () => {
    const checked = { ...filter, dinov2: { threshold: 0.15 } };
    const noise = {
      ...overTolerance,
      blurAmplitude: 40,
      renderingNoiseOnly: true,
      diffBuffer: Buffer.from('the diff'),
    };

    // what the blur would pass, DINOv2 looks at once more
    it('passes a run DINOv2 confirms is only noise', async () => {
      const confirmsNoise = jest.fn().mockResolvedValue({ noise: true, score: 0.05 });
      const { service, saveImage } = await init(noise, confirmsNoise);

      const result = await compare(service, checked);

      expect(confirmsNoise).toHaveBeenCalledWith(Buffer.from('png'), Buffer.from('png'), [], 0.15);
      expect(result.status).toBe(TestStatus.ok);
      expect(saveImage).not.toHaveBeenCalled();
    });

    it('fails a run in which DINOv2 sees a change of content, with its diff', async () => {
      const confirmsNoise = jest.fn().mockResolvedValue({ noise: false, score: 0.56 });
      const { service, saveImage } = await init(noise, confirmsNoise);

      const result = await compare(service, checked);

      expect(result.status).toBe(TestStatus.unresolved);
      expect(result.diffName).toBe('diff.png');
      expect(saveImage).toHaveBeenCalledWith('diff', Buffer.from('the diff'));
    });

    // the worker must keep the diff of a noise-like change, or a run DINOv2
    // sends to review would arrive with nothing to show
    it('asks the worker to keep the diff when a check will follow', async () => {
      const { service, run } = await init(noise, jest.fn().mockResolvedValue({ noise: true }));

      await compare(service, checked);

      expect(run).toHaveBeenCalledWith(expect.objectContaining({ blurAmplitude: checked }));
    });

    // a check that could not look answers without a score: still to review
    it('fails a run DINOv2 could not confirm', async () => {
      const { service } = await init(noise, jest.fn().mockResolvedValue({ noise: false }));

      expect((await compare(service, checked)).status).toBe(TestStatus.unresolved);
    });

    it('does not ask DINOv2 about a change the blur already fails', async () => {
      const confirmsNoise = jest.fn();
      const { service } = await init(
        { ...overTolerance, blurAmplitude: 200, renderingNoiseOnly: false },
        confirmsNoise
      );

      await compare(service, checked);

      expect(confirmsNoise).not.toHaveBeenCalled();
    });

    it('does not ask DINOv2 when the project did not turn the check on', async () => {
      const confirmsNoise = jest.fn();
      const { service } = await init(noise, confirmsNoise);

      expect((await compare(service, filter)).status).toBe(TestStatus.ok);
      expect(confirmsNoise).not.toHaveBeenCalled();
    });
  });
});
