import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CompareService } from './compare.service';
import { DiffWorkerPool } from './diff-worker-pool';
import { LookSameService } from './libs/looks-same/looks-same.service';
import { OdiffService } from './libs/odiff/odiff.service';
import { PixelmatchService } from './libs/pixelmatch/pixelmatch.service';
import { VlmService } from './libs/vlm/vlm.service';
import { OllamaService } from './libs/vlm/providers/ollama/ollama.service';
import { GeminiService } from './libs/vlm/providers/gemini/gemini.service';
import { StaticModule } from '../static/static.module';
import { StaticService } from '../static/static.service';
import { ImageComparison, TestStatus } from '@prisma/client';
import * as utils from '../static/utils';
import { ImageCompareInput } from './libs/ImageCompareInput';
import { BlurredDifference, DEFAULT_BLUR_SIGMA, MAX_SOLID_SHARE } from './libs/pixelmatch/blur-amplitude.core';

jest.mock('zod/v3', () => {
  const actualZod = jest.requireActual('zod');
  return actualZod;
});

describe('CompareService', () => {
  let service: CompareService;
  let pixelmatchService: PixelmatchService;
  let lookSameService: LookSameService;
  let odiffService: OdiffService;
  let vlmService: VlmService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompareService,
        DiffWorkerPool,
        OdiffService,
        PixelmatchService,
        LookSameService,
        VlmService,
        OllamaService,
        GeminiService,
        PrismaService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn(),
          },
        },
      ],
      imports: [StaticModule],
    }).compile();

    service = module.get<CompareService>(CompareService);
    pixelmatchService = module.get<PixelmatchService>(PixelmatchService);
    lookSameService = module.get<LookSameService>(LookSameService);
    odiffService = module.get<OdiffService>(OdiffService);
    vlmService = module.get<VlmService>(VlmService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getComparator', () => {
    it('should return pixelmatchService', () => {
      const result = service.getComparator(ImageComparison.pixelmatch);
      expect(result).toBe(pixelmatchService);
    });

    it('should return lookSameService', () => {
      const result = service.getComparator(ImageComparison.lookSame);
      expect(result).toBe(lookSameService);
    });

    it('should return odiffService', () => {
      jest.spyOn(utils, 'isHddStaticServiceConfigured').mockReturnValue(true);

      expect(service.getComparator(ImageComparison.odiff)).toBe(odiffService);
    });

    it('should throw if not HDD for Odiff', () => {
      jest.spyOn(utils, 'isHddStaticServiceConfigured').mockReturnValue(false);

      expect(() => service.getComparator(ImageComparison.odiff)).toThrow(
        'Odiff can only be used with HDD static service. Please use another image comparison lib in project settings or switch STATIC_SERVICE envitonmental variable to HDD.'
      );
    });

    it('should return vlmService', () => {
      expect(service.getComparator(ImageComparison.vlm)).toBe(vlmService);
    });

    it('should return pixelmatchService for unknown value', () => {
      const result = service.getComparator('unknown' as ImageComparison);
      expect(result).toBe(pixelmatchService);
    });
  });
});

describe('CompareService with mocked collaborators', () => {
  // pixelmatch applies the rendering-noise filter in its own worker pass, and
  // VLM through the pixelmatch it runs first; the others leave it to the service
  const comparator = (name: string, appliesBlurAmplitudeFilter = false) => ({
    parseConfig: jest.fn().mockReturnValue({ parsedBy: name }),
    getDiff: jest.fn().mockResolvedValue({ comparedBy: name }),
    appliesBlurAmplitudeFilter,
  });

  const initService = async ({
    projectFindUniqueMock = jest.fn(),
    diffWorkerPoolRunMock = jest.fn(),
    staticServiceMock = { getImageBuffer: jest.fn(), deleteImage: jest.fn() },
  }) => {
    const pixelmatch = comparator('pixelmatch', true);
    const lookSame = comparator('lookSame');
    const odiff = comparator('odiff');
    const vlm = comparator('vlm', true);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompareService,
        { provide: PixelmatchService, useValue: pixelmatch },
        { provide: LookSameService, useValue: lookSame },
        { provide: OdiffService, useValue: odiff },
        { provide: VlmService, useValue: vlm },
        { provide: PrismaService, useValue: { project: { findUnique: projectFindUniqueMock } } },
        { provide: DiffWorkerPool, useValue: { run: diffWorkerPoolRunMock } },
        { provide: StaticService, useValue: staticServiceMock },
      ],
    }).compile();

    return { service: module.get<CompareService>(CompareService), pixelmatch, lookSame, odiff, vlm };
  };

  const data: ImageCompareInput = {
    baseline: 'baseline.png',
    image: 'image.png',
    diffTollerancePercent: 0.5,
    ignoreAreas: [],
    saveDiffAsFile: true,
  };

  describe('getDiff', () => {
    it("diffs with the project's comparator and the config it parses", async () => {
      const projectFindUniqueMock = jest.fn().mockResolvedValue({
        id: 'projectId',
        imageComparison: ImageComparison.lookSame,
        imageComparisonConfig: '{"strict":true}',
      });
      const { service, lookSame, pixelmatch } = await initService({ projectFindUniqueMock });

      const result = await service.getDiff({ projectId: 'projectId', data });

      expect(projectFindUniqueMock).toHaveBeenCalledWith({ where: { id: 'projectId' } });
      expect(lookSame.parseConfig).toHaveBeenCalledWith('{"strict":true}');
      expect(lookSame.getDiff).toHaveBeenCalledWith(data, { parsedBy: 'lookSame' });
      expect(pixelmatch.getDiff).not.toHaveBeenCalled();
      expect(result).toEqual({ comparedBy: 'lookSame' });
    });

    it('throws a TypeError when the project does not exist', async () => {
      const projectFindUniqueMock = jest.fn().mockResolvedValue(null);
      const { service } = await initService({ projectFindUniqueMock });

      // NOTE: current behavior — no not-found handling, the null project is dereferenced
      await expect(service.getDiff({ projectId: 'missing', data })).rejects.toThrow(TypeError);
    });
  });

  describe('rendering-noise filter', () => {
    const unresolved = {
      status: TestStatus.unresolved,
      diffName: 'diff.png',
      pixelMisMatchCount: 10,
      diffPercent: 5,
      isSameDimension: true,
    };

    // the filter's settings ride in the library's config, which CompareService
    // reads and strips before the comparator sees it
    const filterOn = { blurAmplitudeFilter: true, blurAmplitudeThreshold: 80 };

    const setup = async ({
      imageComparison = ImageComparison.lookSame as ImageComparison,
      config = filterOn as Record<string, unknown>,
      result = unresolved as object,
      measure = { amplitude: 40, solidPixels: 0, solidShare: 0 } as BlurredDifference | null,
      run = jest.fn().mockResolvedValue({ measure }),
    } = {}) => {
      const staticServiceMock = {
        getImageBuffer: jest.fn().mockImplementation(async (name: string) => Buffer.from(name)),
        deleteImage: jest.fn(),
      };
      const projectFindUniqueMock = jest.fn().mockResolvedValue({
        id: 'projectId',
        imageComparison,
        imageComparisonConfig: JSON.stringify({ libraryOption: 1, ...config }),
      });
      const context = await initService({ projectFindUniqueMock, diffWorkerPoolRunMock: run, staticServiceMock });
      [context.pixelmatch, context.lookSame, context.odiff, context.vlm].forEach((c) => {
        c.parseConfig.mockImplementation((json: string) => JSON.parse(json));
        c.getDiff.mockResolvedValue(result);
      });
      return { ...context, run, staticServiceMock };
    };

    const filter = { sigma: DEFAULT_BLUR_SIGMA, threshold: 80 };

    it('leaves a config that does not turn it on alone', async () => {
      const { service, lookSame, run } = await setup({ config: {} });

      const result = await service.getDiff({ projectId: 'projectId', data });

      expect(lookSame.getDiff).toHaveBeenCalledWith(data, { libraryOption: 1 });
      expect(run).not.toHaveBeenCalled();
      expect(result).toEqual(unresolved);
    });

    // decoded already inside its own worker pass, where a run that is about to
    // pass also never writes a diff
    it('hands it to pixelmatch rather than measuring a second time', async () => {
      const { service, pixelmatch, run } = await setup({ imageComparison: ImageComparison.pixelmatch });

      await service.getDiff({ projectId: 'projectId', data });

      expect(pixelmatch.getDiff).toHaveBeenCalledWith({ ...data, blurAmplitude: filter }, { libraryOption: 1 });
      expect(run).not.toHaveBeenCalled();
    });

    // VLM runs pixelmatch first and stops when it passes, so noise is settled
    // before a model is ever asked about it
    it('hands it to VLM as a prefilter', async () => {
      const { service, vlm, run } = await setup({ imageComparison: ImageComparison.vlm });

      await service.getDiff({ projectId: 'projectId', data });

      expect(vlm.getDiff).toHaveBeenCalledWith({ ...data, blurAmplitude: filter }, { libraryOption: 1 });
      expect(run).not.toHaveBeenCalled();
    });

    it('passes a looks-same failure that is only rendering noise', async () => {
      const { service, lookSame, run, staticServiceMock } = await setup();

      const result = await service.getDiff({ projectId: 'projectId', data });

      // looks-same gets its own options, not the filter's
      expect(lookSame.getDiff).toHaveBeenCalledWith(data, { libraryOption: 1 });

      expect(run).toHaveBeenCalledWith({
        kind: 'blur-amplitude',
        baseline: Buffer.from('baseline.png'),
        image: Buffer.from('image.png'),
        ignoreAreas: data.ignoreAreas,
        sigma: DEFAULT_BLUR_SIGMA,
      });
      // the measured mismatch stays, only the verdict changes
      expect(result).toEqual({ ...unresolved, status: TestStatus.ok, diffName: null });
      // nothing will ever point at the diff of a run that passed
      expect(staticServiceMock.deleteImage).toHaveBeenCalledWith('diff.png');
    });

    it('passes an odiff failure that is only rendering noise', async () => {
      jest.spyOn(utils, 'isHddStaticServiceConfigured').mockReturnValue(true);
      const { service } = await setup({ imageComparison: ImageComparison.odiff });

      const result = await service.getDiff({ projectId: 'projectId', data });

      expect(result.status).toBe(TestStatus.ok);
    });

    it('keeps a change stronger than rendering noise unresolved', async () => {
      const { service, staticServiceMock } = await setup({
        measure: { amplitude: 200, solidPixels: 0, solidShare: 0 },
      });

      const result = await service.getDiff({ projectId: 'projectId', data });

      expect(result).toEqual(unresolved);
      expect(staticServiceMock.deleteImage).not.toHaveBeenCalled();
    });

    // a panel turned light grey is faint, but too solid to be noise
    it('keeps a faint but solid change unresolved', async () => {
      const { service } = await setup({
        measure: { amplitude: 31, solidPixels: 9300, solidShare: MAX_SOLID_SHARE + 0.001 },
      });

      expect(await service.getDiff({ projectId: 'projectId', data })).toEqual(unresolved);
    });

    it("measures against the config's own threshold", async () => {
      const { service } = await setup({ config: { ...filterOn, blurAmplitudeThreshold: 30 } });

      expect((await service.getDiff({ projectId: 'projectId', data })).status).toBe(TestStatus.unresolved);
    });

    it('does not second-guess a run that already passed', async () => {
      const ok = { ...unresolved, status: TestStatus.ok, diffName: null };
      const { service, run } = await setup({ result: ok });

      expect(await service.getDiff({ projectId: 'projectId', data })).toEqual(ok);
      expect(run).not.toHaveBeenCalled();
    });

    // nothing to line up, and the size change is a finding of its own
    it('leaves screenshots of different sizes to the comparator', async () => {
      const resized = { ...unresolved, isSameDimension: false };
      const { service, run } = await setup({ result: resized });

      expect(await service.getDiff({ projectId: 'projectId', data })).toEqual(resized);
      expect(run).not.toHaveBeenCalled();
    });

    it('keeps the verdict when the change cannot be measured', async () => {
      const { service } = await setup({ measure: null });

      expect(await service.getDiff({ projectId: 'projectId', data })).toEqual(unresolved);
    });

    // a filter that can only ever pass runs must never be the reason one fails
    it('keeps the verdict when measuring fails', async () => {
      const run = jest.fn().mockRejectedValue(new Error('Image diff queue is full (256 jobs)'));
      const { service } = await setup({ run });

      expect(await service.getDiff({ projectId: 'projectId', data })).toEqual(unresolved);
    });

    it('keeps the verdict when measuring fails with something that is not an Error', async () => {
      const { service } = await setup({ run: jest.fn().mockRejectedValue('worker gone') });

      expect(await service.getDiff({ projectId: 'projectId', data })).toEqual(unresolved);
    });

    it('keeps the verdict when a screenshot cannot be read', async () => {
      const { service, staticServiceMock, run } = await setup();
      staticServiceMock.getImageBuffer.mockResolvedValueOnce(undefined);

      expect(await service.getDiff({ projectId: 'projectId', data })).toEqual(unresolved);
      expect(run).not.toHaveBeenCalled();
    });

    it('has no diff to delete when none was saved', async () => {
      const { service, staticServiceMock } = await setup({ result: { ...unresolved, diffName: null } });

      expect((await service.getDiff({ projectId: 'projectId', data })).status).toBe(TestStatus.ok);
      expect(staticServiceMock.deleteImage).not.toHaveBeenCalled();
    });
  });

  describe('getChangeSignature', () => {
    it('runs a signature job on the diff worker pool and returns its answer', async () => {
      const diffWorkerPoolRunMock = jest.fn().mockResolvedValue({ signature: [0.5, 0.5] });
      const { service } = await initService({ diffWorkerPoolRunMock });
      const input = {
        baseline: Buffer.from('a'),
        image: Buffer.from('b'),
        ignoreAreas: [{ x: 1, y: 2, width: 3, height: 4 }],
        threshold: 0.2,
        includeAA: true,
      };

      const result = await service.getChangeSignature(input);

      expect(diffWorkerPoolRunMock).toHaveBeenCalledWith({ kind: 'signature', ...input });
      expect(result).toEqual({ signature: [0.5, 0.5] });
    });

    it('passes a pool rejection through', async () => {
      const diffWorkerPoolRunMock = jest.fn().mockRejectedValue(new Error('Image diff queue is full (256 jobs)'));
      const { service } = await initService({ diffWorkerPoolRunMock });

      await expect(
        service.getChangeSignature({
          baseline: Buffer.from('a'),
          image: Buffer.from('b'),
          ignoreAreas: [],
          threshold: 0.1,
          includeAA: false,
        })
      ).rejects.toThrow('Image diff queue is full (256 jobs)');
    });
  });
});
