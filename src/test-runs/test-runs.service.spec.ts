import { Test, TestingModule } from '@nestjs/testing';
import { TestRunsService } from './test-runs.service';

describe('TestRunsService', () => {
  let service: TestRunsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TestRunsService],
    }).compile();

    service = module.get<TestRunsService>(TestRunsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
