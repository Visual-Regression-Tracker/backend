import { Test } from '@nestjs/testing';
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
import { Dinov2Service } from './libs/dinov2/dinov2.service';
import { ImageComparison, Project, TestStatus } from '@prisma/client';
import { isHddStaticServiceConfigured } from '../static/utils';
import { ImageCompareInput } from './libs/ImageCompareInput';
import { BlurredDifference, MAX_SOLID_SHARE } from './libs/pixelmatch/blur-amplitude.core';

jest.mock('../static/utils', () => {
  const actual = jest.requireActual('../static/utils');
  return { ...actual, isHddStaticServiceConfigured: jest.fn(actual.isHddStaticServiceConfigured) };
});

describe('CompareService', () => {
  describe('getComparator', () => {
    let service: CompareService;
    let comparators: Record<string, unknown>;

    beforeEach(async () => {
      const module = await Test.createTestingModule({
        providers: [
          CompareService,
          DiffWorkerPool,
          Dinov2Service,
          OdiffService,
          PixelmatchService,
          LookSameService,
          VlmService,
          OllamaService,
          GeminiService,
          PrismaService,
          { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
        ],
        imports: [StaticModule],
      }).compile();

      service = module.get(CompareService);
      comparators = {
        pixelmatch: module.get(PixelmatchService),
        lookSame: module.get(LookSameService),
        odiff: module.get(OdiffService),
        vlm: module.get(VlmService),
      };
    });

    it.each([
      [ImageComparison.pixelmatch, 'pixelmatch'],
      [ImageComparison.lookSame, 'lookSame'],
      [ImageComparison.vlm, 'vlm'],
      ['unknown' as ImageComparison, 'pixelmatch'],
    ])('should return the comparator for %s', (imageComparison, name) => {
      expect(service.getComparator(imageComparison)).toBe(comparators[name]);
    });

    it('should return odiffService', () => {
      jest.mocked(isHddStaticServiceConfigured).mockReturnValue(true);

      expect(service.getComparator(ImageComparison.odiff)).toBe(comparators.odiff);
    });

    it('should throw if not HDD for Odiff', () => {
      jest.mocked(isHddStaticServiceConfigured).mockReturnValue(false);

      expect(() => service.getComparator(ImageComparison.odiff)).toThrow(
        'Odiff can only be used with HDD static service. Please use another image comparison lib in project settings or switch STATIC_SERVICE envitonmental variable to HDD.'
      );
    });
  });
});

describe('CompareService with mocked collaborators', () => {
  const comparator = (appliesBlurAmplitudeFilter = false) => ({
    parseConfig: jest.fn().mockImplementation((json: string) => JSON.parse(json)),
    getDiff: jest.fn(),
    appliesBlurAmplitudeFilter,
  });

  const unresolved = {
    status: TestStatus.unresolved,
    diffName: 'diff.png',
    pixelMisMatchCount: 10,
    diffPercent: 5,
    isSameDimension: true,
  };

  interface Options {
    imageComparison?: ImageComparison;
    config?: Record<string, unknown>;
    project?: Project | null;
    result?: object;
    measure?: BlurredDifference | null;
    gate?: object;
    run?: jest.Mock;
    confirmsNoiseForGate?: jest.Mock;
  }

  const setup = async ({
    imageComparison = ImageComparison.lookSame,
    config = {},
    project,
    result = unresolved,
    measure = { amplitude: 40, solidPixels: 0, solidShare: 0 },
    gate,
    run = jest.fn().mockResolvedValue({ measure, gate }),
    confirmsNoiseForGate = jest.fn(),
  }: Options = {}) => {
    const staticService = {
      getImageBuffer: jest.fn().mockImplementation(async (name: string) => Buffer.from(name)),
      deleteImage: jest.fn(),
    };
    const findUnique = jest
      .fn()
      .mockResolvedValue(
        project === undefined
          ? { id: 'projectId', imageComparison, imageComparisonConfig: JSON.stringify(config) }
          : project
      );
    const pixelmatch = comparator(true);
    const lookSame = comparator();
    const odiff = comparator();
    const vlm = comparator(true);
    [pixelmatch, lookSame, odiff, vlm].forEach((c) => c.getDiff.mockResolvedValue(result));
    const module = await Test.createTestingModule({
      providers: [
        CompareService,
        { provide: PixelmatchService, useValue: pixelmatch },
        { provide: LookSameService, useValue: lookSame },
        { provide: OdiffService, useValue: odiff },
        { provide: VlmService, useValue: vlm },
        { provide: PrismaService, useValue: { project: { findUnique } } },
        { provide: DiffWorkerPool, useValue: { run } },
        { provide: StaticService, useValue: staticService },
        { provide: Dinov2Service, useValue: { confirmsNoiseForGate } },
      ],
    }).compile();

    return {
      service: module.get(CompareService),
      pixelmatch,
      lookSame,
      odiff,
      vlm,
      run,
      staticService,
      findUnique,
      confirmsNoiseForGate,
    };
  };

  const data: ImageCompareInput = {
    baseline: 'baseline.png',
    image: 'image.png',
    diffTollerancePercent: 0.5,
    ignoreAreas: [],
    saveDiffAsFile: true,
  };

  const diffProject = (service: CompareService, input: ImageCompareInput = data) =>
    service.getDiff({ projectId: 'projectId', data: input });

  describe('getDiff', () => {
    it.each([
      ['reads the project and', false],
      ['uses the project it is given without reading it again, and', true],
    ])("%s diffs with the project's comparator and the config it parses", async (_, given) => {
      const { service, lookSame, pixelmatch, findUnique } = await setup({ config: { strict: true } });
      lookSame.parseConfig.mockReturnValue({ parsedBy: 'lookSame' });
      lookSame.getDiff.mockResolvedValue({ comparedBy: 'lookSame' });
      const project = {
        id: 'projectId',
        imageComparison: ImageComparison.lookSame,
        imageComparisonConfig: '{"strict":true}',
      } as Project;

      const result = await service.getDiff({ projectId: 'projectId', ...(given ? { project } : {}), data });

      if (given) {
        expect(findUnique).not.toHaveBeenCalled();
      } else {
        expect(findUnique).toHaveBeenCalledWith({ where: { id: 'projectId' } });
      }
      expect(lookSame.parseConfig).toHaveBeenCalledWith('{"strict":true}');
      expect(lookSame.getDiff).toHaveBeenCalledWith(data, { parsedBy: 'lookSame' });
      expect(pixelmatch.getDiff).not.toHaveBeenCalled();
      expect(result).toEqual({ comparedBy: 'lookSame' });
    });

    it('throws a TypeError when the project does not exist', async () => {
      const { service } = await setup({ project: null });

      await expect(service.getDiff({ projectId: 'missing', data })).rejects.toThrow(TypeError);
    });
  });

  describe('rendering-noise filter', () => {
    const filterOn = { blurAmplitudeFilter: true, blurAmplitudeThreshold: 80 };
    const filtered = (options: Options = {}) =>
      setup({ ...options, config: { libraryOption: 1, ...(options.config ?? filterOn) } });

    it('leaves a config that does not turn it on alone', async () => {
      const { service, lookSame, run } = await filtered({ config: {} });

      const result = await diffProject(service);

      expect(lookSame.getDiff).toHaveBeenCalledWith(data, { libraryOption: 1 });
      expect(run).not.toHaveBeenCalled();
      expect(result).toEqual(unresolved);
    });

    it.each([
      ['pixelmatch rather than measuring a second time', ImageComparison.pixelmatch, 'pixelmatch'],
      ['VLM as a prefilter', ImageComparison.vlm, 'vlm'],
    ] as const)('hands it to %s', async (_, imageComparison, key) => {
      const context = await filtered({ imageComparison });

      await diffProject(context.service);

      expect(context[key].getDiff).toHaveBeenCalledWith(
        { ...data, blurAmplitude: { threshold: 80 } },
        { libraryOption: 1 }
      );
      expect(context.run).not.toHaveBeenCalled();
    });

    it('passes a looks-same failure that is only rendering noise', async () => {
      const { service, lookSame, run, staticService } = await filtered();

      const result = await diffProject(service);

      expect(lookSame.getDiff).toHaveBeenCalledWith(data, { libraryOption: 1 });
      expect(run).toHaveBeenCalledWith({
        kind: 'blur-amplitude',
        baseline: Buffer.from('baseline.png'),
        image: Buffer.from('image.png'),
        ignoreAreas: data.ignoreAreas,
      });
      expect(result).toEqual({ ...unresolved, status: TestStatus.ok, diffName: null });
      expect(staticService.deleteImage).toHaveBeenCalledWith('diff.png');
    });

    it('measures with the image it is given', async () => {
      const { service, run, staticService } = await filtered();
      const imageBuffer = Buffer.from('already read');

      await diffProject(service, { ...data, imageBuffer });

      expect(staticService.getImageBuffer).toHaveBeenCalledTimes(1);
      expect(staticService.getImageBuffer).toHaveBeenCalledWith('baseline.png');
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ kind: 'blur-amplitude', image: imageBuffer }));
      expect(run.mock.calls[0][0].image).toBe(imageBuffer);
    });

    it('passes an odiff failure that is only rendering noise', async () => {
      jest.mocked(isHddStaticServiceConfigured).mockReturnValue(true);
      const { service } = await filtered({ imageComparison: ImageComparison.odiff });

      expect((await diffProject(service)).status).toBe(TestStatus.ok);
    });

    it('keeps a change stronger than rendering noise unresolved', async () => {
      const { service, staticService } = await filtered({
        measure: { amplitude: 200, solidPixels: 0, solidShare: 0 },
      });

      expect(await diffProject(service)).toEqual(unresolved);
      expect(staticService.deleteImage).not.toHaveBeenCalled();
    });

    it('keeps a faint but solid change unresolved', async () => {
      const { service } = await filtered({
        measure: { amplitude: 31, solidPixels: 9300, solidShare: MAX_SOLID_SHARE + 0.001 },
      });

      expect(await diffProject(service)).toEqual(unresolved);
    });

    it("measures against the config's own threshold", async () => {
      const { service } = await filtered({ config: { ...filterOn, blurAmplitudeThreshold: 30 } });

      expect((await diffProject(service)).status).toBe(TestStatus.unresolved);
    });

    it('does not second-guess a run that already passed', async () => {
      const ok = { ...unresolved, status: TestStatus.ok, diffName: null as string | null };
      const { service, run } = await filtered({ result: ok });

      expect(await diffProject(service)).toEqual(ok);
      expect(run).not.toHaveBeenCalled();
    });

    it('leaves screenshots of different sizes to the comparator', async () => {
      const resized = { ...unresolved, isSameDimension: false };
      const { service, run } = await filtered({ result: resized });

      expect(await diffProject(service)).toEqual(resized);
      expect(run).not.toHaveBeenCalled();
    });

    it('keeps the verdict when the change cannot be measured', async () => {
      const { service } = await filtered({ measure: null });

      expect(await diffProject(service)).toEqual(unresolved);
    });

    it.each([
      ['an Error', new Error('Image diff queue is full (256 jobs)')],
      ['something that is not an Error', 'worker gone'],
    ])('keeps the verdict when measuring fails with %s', async (_, failure) => {
      const { service } = await filtered({ run: jest.fn().mockRejectedValue(failure) });

      expect(await diffProject(service)).toEqual(unresolved);
    });

    it('keeps the verdict when a screenshot cannot be read', async () => {
      const { service, staticService, run } = await filtered();
      staticService.getImageBuffer.mockResolvedValueOnce(undefined);

      expect(await diffProject(service)).toEqual(unresolved);
      expect(run).not.toHaveBeenCalled();
    });

    it('has no diff to delete when none was saved', async () => {
      const { service, staticService } = await filtered({ result: { ...unresolved, diffName: null } });

      expect((await diffProject(service)).status).toBe(TestStatus.ok);
      expect(staticService.deleteImage).not.toHaveBeenCalled();
    });
  });

  describe('rendering-noise filter with the DINOv2 check', () => {
    const gate = { width: 5, height: 3, cells: [7] };
    const checked = (options: Options = {}) =>
      setup({ gate, config: { blurAmplitudeFilter: true, dinov2Check: true }, ...options });
    const dinov2 = { threshold: 0.15 };

    it('passes a looks-same failure DINOv2 confirms is only noise, with the gate the blur job returned', async () => {
      const confirmsNoiseForGate = jest.fn().mockResolvedValue({ noise: true, score: 0.04 });
      const { service, staticService, run } = await checked({ confirmsNoiseForGate });

      const result = await diffProject(service);

      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith({
        kind: 'blur-amplitude',
        baseline: Buffer.from('baseline.png'),
        image: Buffer.from('image.png'),
        ignoreAreas: data.ignoreAreas,
        gateIfNoise: { threshold: 80 },
      });
      expect(confirmsNoiseForGate).toHaveBeenCalledWith(
        gate,
        Buffer.from('baseline.png'),
        Buffer.from('image.png'),
        0.15
      );
      expect(result.status).toBe(TestStatus.ok);
      expect(staticService.deleteImage).toHaveBeenCalledWith('diff.png');
    });

    it('keeps a looks-same failure in which DINOv2 sees a change of content', async () => {
      const { service, staticService } = await checked({
        confirmsNoiseForGate: jest.fn().mockResolvedValue({ noise: false, score: 0.56 }),
      });

      expect(await diffProject(service)).toEqual(unresolved);
      expect(staticService.deleteImage).not.toHaveBeenCalled();
    });

    it('keeps the failure and does not ask DINOv2 when the blur job returned no gate', async () => {
      const confirmsNoiseForGate = jest.fn();
      const { service, staticService } = await checked({
        gate: undefined,
        confirmsNoiseForGate,
      });

      expect(await diffProject(service)).toEqual(unresolved);
      expect(confirmsNoiseForGate).not.toHaveBeenCalled();
      expect(staticService.deleteImage).not.toHaveBeenCalled();
    });

    it.each([
      [
        'a change the blur already fails',
        { run: jest.fn().mockResolvedValue({ measure: { amplitude: 200, solidPixels: 0, solidShare: 0 } }) },
      ],
      ['a pair when the blur job fails', { run: jest.fn().mockRejectedValue(new Error('worker crashed')) }],
    ])('does not ask DINOv2 about %s', async (_, options) => {
      const confirmsNoiseForGate = jest.fn();
      const { service } = await checked({ ...options, confirmsNoiseForGate });

      expect(await diffProject(service)).toEqual(unresolved);
      expect(confirmsNoiseForGate).not.toHaveBeenCalled();
    });

    it.each([
      [ImageComparison.pixelmatch, 'pixelmatch'],
      [ImageComparison.vlm, 'vlm'],
    ] as const)('hands the check to %s', async (imageComparison, key) => {
      const context = await checked({ imageComparison });

      await diffProject(context.service);

      expect(context[key].getDiff).toHaveBeenCalledWith({ ...data, blurAmplitude: { threshold: 80, dinov2 } }, {});
      expect(context.confirmsNoiseForGate).not.toHaveBeenCalled();
    });
  });

  describe('getChangeSignature', () => {
    const input = {
      baseline: Buffer.from('a'),
      image: Buffer.from('b'),
      ignoreAreas: [{ x: 1, y: 2, width: 3, height: 4 }],
      threshold: 0.2,
      includeAA: true,
    };

    it('runs a signature job on the diff worker pool and returns its answer', async () => {
      const { service, run } = await setup({ run: jest.fn().mockResolvedValue({ signature: [0.5, 0.5] }) });

      const result = await service.getChangeSignature(input);

      expect(run).toHaveBeenCalledWith({ kind: 'signature', ...input });
      expect(result).toEqual({ signature: [0.5, 0.5] });
    });

    it('passes a pool rejection through', async () => {
      const { service } = await setup({
        run: jest.fn().mockRejectedValue(new Error('Image diff queue is full (256 jobs)')),
      });

      await expect(service.getChangeSignature(input)).rejects.toThrow('Image diff queue is full (256 jobs)');
    });
  });
});
