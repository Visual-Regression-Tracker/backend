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
import { ImageComparison } from '@prisma/client';
import * as utils from '../static/utils';

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
  const comparator = (name: string) => ({
    parseConfig: jest.fn().mockReturnValue({ parsedBy: name }),
    getDiff: jest.fn().mockResolvedValue({ comparedBy: name }),
  });

  const initService = async ({ projectFindUniqueMock = jest.fn(), diffWorkerPoolRunMock = jest.fn() }) => {
    const pixelmatch = comparator('pixelmatch');
    const lookSame = comparator('lookSame');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompareService,
        { provide: PixelmatchService, useValue: pixelmatch },
        { provide: LookSameService, useValue: lookSame },
        { provide: OdiffService, useValue: comparator('odiff') },
        { provide: VlmService, useValue: comparator('vlm') },
        { provide: PrismaService, useValue: { project: { findUnique: projectFindUniqueMock } } },
        { provide: DiffWorkerPool, useValue: { run: diffWorkerPoolRunMock } },
      ],
    }).compile();

    return { service: module.get<CompareService>(CompareService), pixelmatch, lookSame };
  };

  const data = {
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
