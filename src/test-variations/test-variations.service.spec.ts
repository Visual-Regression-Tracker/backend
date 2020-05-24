import { Test, TestingModule } from '@nestjs/testing';
import { TestVariationsService } from './test-variations.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTestRequestDto } from '../test/dto/create-test-request.dto';
import { StaticService } from '../shared/static/static.service';

const initModule = async ({
  findManyMock = jest.fn().mockReturnValue([]),
  createMock = jest.fn(),
}) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TestVariationsService,
      { provide: StaticService, useValue: {} },
      {
        provide: PrismaService, useValue: {
          testVariation: {
            findMany: findManyMock,
            create: createMock
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

  describe('findOrCreate', () => {

    it('can find by required fields', async () => {
      const data = dataRequiredFields
      const findManyMock = jest.fn()
      service = await initModule({ findManyMock: findManyMock.mockResolvedValueOnce([data]) })

      const result = await service.findOrCreate(data)

      expect(findManyMock).toHaveBeenCalledWith({
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
      const findManyMock = jest.fn()
      service = await initModule({ findManyMock: findManyMock.mockResolvedValueOnce([data]) })

      const result = await service.findOrCreate(data)

      expect(findManyMock).toHaveBeenCalledWith({
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
      const createMock = jest.fn()
      service = await initModule({ createMock: createMock.mockResolvedValueOnce(data) })

      const result = await service.findOrCreate(data)

      expect(createMock).toHaveBeenCalledWith({
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
});
