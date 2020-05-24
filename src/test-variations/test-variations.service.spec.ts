import { Test, TestingModule } from '@nestjs/testing';
import { TestVariationsService } from './test-variations.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTestRequestDto } from '../test/dto/create-test-request.dto';
import { StaticService } from '../shared/static/static.service';
import { IgnoreAreaDto } from 'src/test/dto/ignore-area.dto';
import { TestVariation, Baseline } from '@prisma/client';

const initModule = async ({
  imageDeleteMock = jest.fn(),
  variationFindOneMock = jest.fn,
  variationFindManyMock = jest.fn().mockReturnValue([]),
  variationCreateMock = jest.fn(),
  variationUpdateMock = jest.fn(),
  variationDeleteMock = jest.fn(),
  baselineDeleteMock = jest.fn()
}) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TestVariationsService,
      {
        provide: StaticService, useValue: {
          deleteImage: imageDeleteMock
        }
      },
      {
        provide: PrismaService, useValue: {
          testVariation: {
            findOne: variationFindOneMock,
            findMany: variationFindManyMock,
            create: variationCreateMock,
            update: variationUpdateMock,
            delete: variationDeleteMock,
          },
          baseline: {
            delete: baselineDeleteMock
          }
        }
      },
    ],
  }).compile();

  return module.get<TestVariationsService>(TestVariationsService);
}

const dataRequiredFields: CreateTestRequestDto = {
  buildId: 'buildId',
  projectId: 'projectId',
  name: 'Test name',
  imageBase64: 'Image'
}

const dataAllFields: CreateTestRequestDto = {
  buildId: 'buildId',
  projectId: 'projectId',
  name: 'Test name',
  imageBase64: 'Image',
  os: 'OS',
  browser: 'browser',
  viewport: 'viewport',
  device: 'device',
}

describe('TestVariationsService', () => {
  let service: TestVariationsService;

  describe('getDetails', () => {
    it('can find one', async () => {
      const id = 'test id'
      const variationFindOneMock = jest.fn()
      service = await initModule({ variationFindOneMock })

      await service.getDetails(id)

      expect(variationFindOneMock).toHaveBeenCalledWith({
        where: { id },
        include: {
          baselines: {
            include: {
              testRun: true,
            },
            orderBy: {
              createdAt: 'desc'
            }
          },
        }
      })
    })
  })

  describe('findOrCreate', () => {

    it('can find by required fields', async () => {
      const data = dataRequiredFields
      const variationFindManyMock = jest.fn()
      service = await initModule({ variationFindManyMock: variationFindManyMock.mockResolvedValueOnce([data]) })

      const result = await service.findOrCreate(data)

      expect(variationFindManyMock).toHaveBeenCalledWith({
        where: {
          name: data.name,
          projectId: data.projectId,
          os: null,
          browser: null,
          viewport: null,
          device: null,
        },
      })
      expect(result).toBe(data)
    })

    it('can find by all fields', async () => {
      const data = dataAllFields
      const variationFindManyMock = jest.fn()
      service = await initModule({ variationFindManyMock: variationFindManyMock.mockResolvedValueOnce([data]) })

      const result = await service.findOrCreate(data)

      expect(variationFindManyMock).toHaveBeenCalledWith({
        where: {
          name: data.name,
          projectId: data.projectId,
          os: data.os,
          browser: data.browser,
          viewport: data.viewport,
          device: data.device,
        },
      })
      expect(result).toBe(data)
    })

    it('can create if not found', async () => {
      const data = dataAllFields
      const variationCreateMock = jest.fn()
      service = await initModule({ variationCreateMock: variationCreateMock.mockResolvedValueOnce(data) })

      const result = await service.findOrCreate(data)

      expect(variationCreateMock).toHaveBeenCalledWith({
        data: {
          name: data.name,
          os: data.os,
          browser: data.browser,
          viewport: data.viewport,
          device: data.device,
          project: {
            connect: {
              id: data.projectId,
            }
          }
        },
      })
      expect(result).toBe(data)
    })
  })

  describe('updateIgnoreAreas', () => {
    it('can update', async () => {
      const id = 'test id'
      const ignoreAreas: IgnoreAreaDto[] = [
        {
          x: 1,
          y: 2.3,
          width: 442.1,
          height: 32.0
        }
      ]
      const variationUpdateMock = jest.fn()
      service = await initModule({ variationUpdateMock })

      await service.updateIgnoreAreas(id, ignoreAreas)

      expect(variationUpdateMock).toBeCalledWith({
        where: {
          id
        },
        data: {
          ignoreAreas: JSON.stringify(ignoreAreas)
        }
      })
    })
  })

  describe('remove', () => {
    it('can remove', async () => {
      const id = 'test id'
      const variation: TestVariation & {
        baselines: Baseline[];
      } = {
        id,
        projectId: 'project Id',
        name: 'Test name',
        baselineName: 'baselineName',
        os: 'OS',
        browser: 'browser',
        viewport: 'viewport',
        device: 'device',
        ignoreAreas: '[]',
        createdAt: new Date(),
        updatedAt: new Date(),
        baselines: [
          {
            id: 'baseline id 1',
            baselineName: 'image name 1',
            testVariationId: id,
            testRunId: 'test run id 1',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]
      }
      const variationFindOneMock = jest.fn()
      const variationDeleteMock = jest.fn()
      const imageDeleteMock = jest.fn()
      const baselineDeleteMock = jest.fn()
      service = await initModule(
        {
          variationFindOneMock: variationFindOneMock.mockResolvedValueOnce(variation),
          variationDeleteMock,
          imageDeleteMock,
          baselineDeleteMock
        })

      await service.remove(id)

      expect(imageDeleteMock).toHaveBeenCalledWith(
        variation.baselines[0].baselineName
      )
      expect(baselineDeleteMock).toHaveBeenCalledWith({
        where: { id: variation.baselines[0].id }
      })
      expect(variationDeleteMock).toHaveBeenCalledWith({
        where: { id: variation.id }
      })
    })
  })
});
