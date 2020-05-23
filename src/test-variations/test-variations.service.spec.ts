import { Test, TestingModule } from '@nestjs/testing';
import { TestVariationsService } from './test-variations.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TestVariationsService', () => {
  let service: TestVariationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestVariationsService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    service = module.get<TestVariationsService>(TestVariationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
