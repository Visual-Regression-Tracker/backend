import { TasksService } from './tasks.service';
import { generateTestVariation, TEST_PROJECT } from '../../_data_';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { TestVariationsService } from '../../test-variations/test-variations.service';

const initService = async ({
  projectFindManyMock = jest.fn(),
  findOldTestVariationsMock = jest.fn(),
  testVariationsDeleteMock = jest.fn(),
}) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TasksService,
      {
        provide: PrismaService,
        useValue: {
          project: {
            findMany: projectFindManyMock,
          },
        },
      },
      {
        provide: TestVariationsService,
        useValue: {
          delete: testVariationsDeleteMock,
          findOldTestVariations: findOldTestVariationsMock,
        },
      },
    ],
  }).compile();

  return module.get<TasksService>(TasksService);
};

describe('cleanOldTestVariations', () => {
  let service: TasksService;

  it('findMany', async () => {
    // .Arrange
    const project = TEST_PROJECT;
    const testVariation = generateTestVariation();
    const projectFindManyMock = jest.fn().mockResolvedValueOnce([project]);
    const findOldTestVariationsMock = jest.fn().mockResolvedValueOnce([testVariation]);
    const testVariationsDeleteMock = jest.fn();
    service = await initService({
      projectFindManyMock: projectFindManyMock,
      findOldTestVariationsMock: findOldTestVariationsMock,
      testVariationsDeleteMock: testVariationsDeleteMock,
    });
    const dateNow = new Date('2022-10-23');
    jest.useFakeTimers().setSystemTime(dateNow);
    const dateRemoveAfter: Date = new Date(dateNow);
    dateRemoveAfter.setDate(dateRemoveAfter.getDate() - project.maxBranchLifetime);

    // .Act
    await service.cleanOldTestVariations();

    // .Assert
    expect(findOldTestVariationsMock).toHaveBeenCalledWith(project, dateRemoveAfter);
    expect(testVariationsDeleteMock).toBeCalledWith(testVariation.id);
  });
});
