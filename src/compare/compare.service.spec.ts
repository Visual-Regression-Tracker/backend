import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CompareService } from './compare.service';
import { LookSameService } from './libs/looks-same/looks-same.service';
import { OdiffService } from './libs/odiff/odiff.service';
import { PixelmatchService } from './libs/pixelmatch/pixelmatch.service';
import { HardDiskService } from '../shared/static/hard-disk.service';
import { STATIC_SERVICE } from '../shared/static/static-service.interface';

describe('CompareService', () => {
  let service: CompareService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: STATIC_SERVICE,
          useClass: HardDiskService,
        },
        CompareService,
        OdiffService,
        PixelmatchService,
        LookSameService,
        PrismaService,
      ],
    }).compile();

    service = module.get<CompareService>(CompareService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
