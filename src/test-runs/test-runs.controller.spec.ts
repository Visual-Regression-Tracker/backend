import { Test, TestingModule } from '@nestjs/testing';
import { TestRunsController } from './test-runs.controller';

describe('TestRuns Controller', () => {
  let controller: TestRunsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TestRunsController],
    }).compile();

    controller = module.get<TestRunsController>(TestRunsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
