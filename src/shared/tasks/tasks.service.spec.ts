import { TasksService } from "./tasks.service";
import {generateTestVariation, TEST_PROJECT} from '../../_data_';
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from '../../prisma/prisma.service';
import { TestVariationsService } from "../../test-variations/test-variations.service";

const initService = async ({
        projectFindManyMock = jest.fn(),
        testVariationFindManyMock = jest.fn(),
        testVariationsDeleteMock = jest.fn(),
    }) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        {
          provide: PrismaService,
          useValue: {
            testVariation: {
              findMany: testVariationFindManyMock,
            },
            project: {
              findMany: projectFindManyMock,
            },
          },
        },
        {
          provide: TestVariationsService,
          useValue: {
            delete: testVariationsDeleteMock,
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
        const project = TEST_PROJECT
        const testVariation = generateTestVariation()
        const projectFindManyMock = jest.fn().mockResolvedValueOnce([project]);
        const testVariationFindManyMock = jest.fn().mockResolvedValueOnce([testVariation])
        const testVariationsDeleteMock = jest.fn()
        service = await initService({
            projectFindManyMock: projectFindManyMock,
            testVariationFindManyMock: testVariationFindManyMock,
            testVariationsDeleteMock: testVariationsDeleteMock
        });
        // .Act
        await service.cleanOldTestVariations()

        // .Assert: this fork switched the cleanup off, so no branch baseline is ever removed.
        expect(testVariationFindManyMock).not.toHaveBeenCalled();
        expect(testVariationsDeleteMock).not.toHaveBeenCalled();
    });
    
})  