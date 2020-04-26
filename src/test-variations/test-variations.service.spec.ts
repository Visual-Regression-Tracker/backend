import { Test, TestingModule } from '@nestjs/testing';
import { TestVariationsService } from './test-variations.service';

describe('TestVariationsService', () => {
  let service: TestVariationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TestVariationsService],
    }).compile();

    service = module.get<TestVariationsService>(TestVariationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
