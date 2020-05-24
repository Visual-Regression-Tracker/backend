import { Test, TestingModule } from '@nestjs/testing';
import { TestService } from './test.service';
import { TestRunsService } from '../test-runs/test-runs.service';
import { TestVariationsService } from '../test-variations/test-variations.service';

describe('TestService', () => {
  let service: TestService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TestService, { provide: TestRunsService, useValue: {} }, { provide: TestVariationsService, useValue: {} },],
    }).compile();

    service = module.get<TestService>(TestService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
