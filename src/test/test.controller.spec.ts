import { Test, TestingModule } from '@nestjs/testing';
import { TestController } from './test.controller';
import { TestService } from './test.service';
import { TestVariationsService } from '../test-variations/test-variations.service';
import { TestRunsService } from '../test-runs/test-runs.service';
import { PrismaService } from '../prisma/prisma.service';

describe('Test Controller', () => {
  let controller: TestController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TestController],
      providers: [
        { provide: PrismaService, useValue: {} },
        { provide: TestService, useValue: {} },
        { provide: TestVariationsService, useValue: {} },
        { provide: TestRunsService, useValue: {} },
      ],
    }).compile();

    controller = module.get<TestController>(TestController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
