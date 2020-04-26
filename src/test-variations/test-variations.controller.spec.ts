import { Test, TestingModule } from '@nestjs/testing';
import { TestVariationsController } from './test-variations.controller';

describe('TestVariations Controller', () => {
  let controller: TestVariationsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TestVariationsController],
    }).compile();

    controller = module.get<TestVariationsController>(TestVariationsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
