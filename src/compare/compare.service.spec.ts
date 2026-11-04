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
import { ImageComparison, Project, TestStatus } from '@prisma/client';
import { isHddStaticServiceConfigured } from '../static/utils';
import { ImageCompareInput } from './libs/ImageCompareInput';

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
  const comparator = () => ({
    parseConfig: jest.fn().mockImplementation((json: string) => JSON.parse(json)),
    getDiff: jest.fn(),
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
    run?: jest.Mock;
  }

  const setup = async ({
    imageComparison = ImageComparison.lookSame,
    config = {},
    project,
    result = unresolved,
    run = jest.fn(),
  }: Options = {}) => {
    const findUnique = jest
      .fn()
      .mockResolvedValue(
        project === undefined
          ? { id: 'projectId', imageComparison, imageComparisonConfig: JSON.stringify(config) }
          : project
      );
    const pixelmatch = comparator();
    const lookSame = comparator();
    const odiff = comparator();
    const vlm = comparator();
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
      ],
    }).compile();

    return {
      service: module.get(CompareService),
      pixelmatch,
      lookSame,
      odiff,
      vlm,
      run,
      findUnique,
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

  describe('ignoreRenderingNoise in a stored config', () => {
    it.each([ImageComparison.lookSame, ImageComparison.pixelmatch, ImageComparison.vlm])(
      'is cut out before %s sees the config and changes no result',
      async (imageComparison) => {
        const context = await setup({ imageComparison, config: { libraryOption: 1, ignoreRenderingNoise: true } });
        const comparator = context[imageComparison === ImageComparison.lookSame ? 'lookSame' : imageComparison];

        const result = await diffProject(context.service);

        expect(comparator.getDiff).toHaveBeenCalledWith(data, { libraryOption: 1 });
        expect(result).toEqual(unresolved);
      }
    );
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
