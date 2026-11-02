import { Test, TestingModule } from '@nestjs/testing';
import { TestVariationsController } from './test-variations.controller';
import { TestVariationsService } from './test-variations.service';
import { PrismaService } from '../prisma/prisma.service';
import { generateTestVariation } from '../_data_';

describe('TestVariations Controller', () => {
  let controller: TestVariationsController;
  const testVariationsService = {
    getDetails: jest.fn(),
    merge: jest.fn(),
    delete: jest.fn(),
  };
  const prismaService = {
    testVariation: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TestVariationsController],
      providers: [
        { provide: TestVariationsService, useValue: testVariationsService },
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    controller = module.get<TestVariationsController>(TestVariationsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists the variations of a project straight from the database', async () => {
    const variations = [generateTestVariation()];
    prismaService.testVariation.findMany.mockResolvedValue(variations);

    await expect(controller.getList('projectId')).resolves.toBe(variations);
    expect(prismaService.testVariation.findMany).toHaveBeenCalledWith({ where: { projectId: 'projectId' } });
  });

  it('returns the details of one variation', async () => {
    const variation = generateTestVariation();
    testVariationsService.getDetails.mockResolvedValue(variation);

    await expect(controller.getDetails('variationId')).resolves.toBe(variation);
    expect(testVariationsService.getDetails).toHaveBeenCalledWith('variationId');
  });

  it('merges one branch into another', async () => {
    const build = { id: 'buildId' };
    testVariationsService.merge.mockResolvedValue(build);

    await expect(controller.merge({ projectId: 'projectId', fromBranch: 'develop', toBranch: 'master' })).resolves.toBe(
      build
    );
    expect(testVariationsService.merge).toHaveBeenCalledWith('projectId', 'develop', 'master');
  });

  it('deletes a variation', async () => {
    const variation = generateTestVariation();
    testVariationsService.delete.mockResolvedValue(variation);

    await expect(controller.delete('variationId')).resolves.toBe(variation);
    expect(testVariationsService.delete).toHaveBeenCalledWith('variationId');
  });
});
