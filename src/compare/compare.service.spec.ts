import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CompareService } from './compare.service';
import { LookSameService } from './libs/looks-same/looks-same.service';
import { OdiffService } from './libs/odiff/odiff.service';
import { PixelmatchService } from './libs/pixelmatch/pixelmatch.service';
import { VlmService } from './libs/vlm/vlm.service';
import { OllamaService } from './libs/vlm/ollama.service';
import { StaticModule } from '../static/static.module';
import { ImageComparison } from '@prisma/client';
import * as utils from '../static/utils';

describe('CompareService', () => {
  let service: CompareService;
  let pixelmatchService: PixelmatchService;
  let lookSameService: LookSameService;
  let odiffService: OdiffService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompareService,
        OdiffService,
        PixelmatchService,
        LookSameService,
        VlmService,
        OllamaService,
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

    it('should return pixelmatchService for unknown value', () => {
      const result = service.getComparator('unknown' as ImageComparison);
      expect(result).toBe(pixelmatchService);
    });
  });
});
