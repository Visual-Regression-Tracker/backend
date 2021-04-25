import { Test, TestingModule } from '@nestjs/testing';
import { StaticService } from '../shared/static/static.service';
import { CompareService } from './compare.service';
import { PixelmatchService } from './libs/pixelmatch.service';

describe('CompareService', () => {
  let service: CompareService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CompareService, PixelmatchService, StaticService],
    }).compile();

    service = module.get<CompareService>(CompareService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
