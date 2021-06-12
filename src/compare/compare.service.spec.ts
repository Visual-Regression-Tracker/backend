import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { StaticService } from '../shared/static/static.service';
import { CompareService } from './compare.service';
import { LookSameService } from './libs/looks-same/looks-same.service';
import { PixelmatchService } from './libs/pixelmatch/pixelmatch.service';

describe('CompareService', () => {
  let service: CompareService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CompareService, PixelmatchService, LookSameService, StaticService, PrismaService],
    }).compile();

    service = module.get<CompareService>(CompareService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
