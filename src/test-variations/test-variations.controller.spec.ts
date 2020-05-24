import { Test, TestingModule } from '@nestjs/testing';
import { TestVariationsController } from './test-variations.controller';
import { TestVariationsService } from './test-variations.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TestVariations Controller', () => {
  let controller: TestVariationsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TestVariationsController],
      providers: [
        { provide: TestVariationsService, useValue: {} },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = module.get<TestVariationsController>(TestVariationsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
