import { Test, TestingModule } from '@nestjs/testing';
import { TestRunsService } from './test-runs.service';
import { PrismaService } from '../prisma/prisma.service';
import { StaticService } from '../shared/static/static.service';

describe('TestRunsService', () => {
  let service: TestRunsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TestRunsService,
        { provide: PrismaService, useValue: {} },
        { provide: StaticService, useValue: {} },],
    }).compile();

    service = module.get<TestRunsService>(TestRunsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
