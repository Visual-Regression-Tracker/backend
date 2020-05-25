import { mocked } from 'ts-jest/utils';
import { Test, TestingModule } from '@nestjs/testing';
import { TestRunsService } from './test-runs.service';
import { PrismaService } from '../prisma/prisma.service';
import { StaticService } from '../shared/static/static.service';
import { PNG } from 'pngjs';
import { TestStatus } from '@prisma/client';
import Pixelmatch from 'pixelmatch';
import { CreateTestRequestDto } from 'src/test/dto/create-test-request.dto';

jest.mock('pixelmatch');

const initService = async ({
  testRunCreateMock = jest.fn(),
  getImageMock = jest.fn(),
  saveImageMock = jest.fn(),
}) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [TestRunsService,
      {
        provide: PrismaService, useValue: {
          testRun: {
            create: testRunCreateMock
          }
        }
      },
      {
        provide: StaticService, useValue: {
          getImage: getImageMock,
          saveImage: saveImageMock
        }
      },],
  }).compile();

  return module.get<TestRunsService>(TestRunsService);
}
describe('TestRunsService', () => {
  let service: TestRunsService;

  describe('create', () => {
    const initCreateTestRequestDto: CreateTestRequestDto = {
      buildId: 'buildId',
      projectId: 'projectId',
      name: 'Test name',
      imageBase64: 'Image',
      os: 'OS',
      browser: 'browser',
      viewport: 'viewport',
      device: 'device',
    }

    it('no baseline', async () => {
      const testVariation = {
        id: '123',
        projectId: 'project Id',
        name: 'Test name',
        baselineName: null,
        os: 'OS',
        browser: 'browser',
        viewport: 'viewport',
        device: 'device',
        ignoreAreas: '[]',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const createTestRequestDto = initCreateTestRequestDto
      const testRunCreateMock = jest.fn()
      const imageName = 'image name'
      const saveImageMock = jest.fn().mockReturnValueOnce(imageName)
      service = await initService({ testRunCreateMock, saveImageMock })

      await service.create(testVariation, createTestRequestDto)

      expect(testRunCreateMock).toHaveBeenCalledWith({
        data: {
          imageName,
          testVariation: {
            connect: {
              id: testVariation.id,
            },
          },
          build: {
            connect: {
              id: createTestRequestDto.buildId,
            },
          },
          name: testVariation.name,
          browser: testVariation.browser,
          device: testVariation.device,
          os: testVariation.os,
          viewport: testVariation.viewport,
          baselineName: testVariation.baselineName,
          ignoreAreas: testVariation.ignoreAreas,
          diffTollerancePercent: createTestRequestDto.diffTollerancePercent,
          diffName: undefined,
          pixelMisMatchCount: undefined,
          diffPercent: undefined,
          status: TestStatus.new,
        },
      })
    })

    it('with deleted baseline', async () => {
      const testVariation = {
        id: '123',
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
      }
      const createTestRequestDto = initCreateTestRequestDto
      const testRunCreateMock = jest.fn()
      const imageName = 'image name'
      const saveImageMock = jest.fn().mockReturnValueOnce(imageName)
      const getImageMock = jest.fn().mockReturnValueOnce(null)
      service = await initService({ testRunCreateMock, saveImageMock, getImageMock })

      await service.create(testVariation, createTestRequestDto)

      expect(getImageMock).toHaveBeenCalledWith(testVariation.baselineName)
      expect(testRunCreateMock).toHaveBeenCalledWith({
        data: {
          imageName,
          testVariation: {
            connect: {
              id: testVariation.id,
            },
          },
          build: {
            connect: {
              id: createTestRequestDto.buildId,
            },
          },
          name: testVariation.name,
          browser: testVariation.browser,
          device: testVariation.device,
          os: testVariation.os,
          viewport: testVariation.viewport,
          baselineName: testVariation.baselineName,
          ignoreAreas: testVariation.ignoreAreas,
          diffTollerancePercent: createTestRequestDto.diffTollerancePercent,
          diffName: undefined,
          pixelMisMatchCount: undefined,
          diffPercent: undefined,
          status: TestStatus.new,
        },
      })
    })

    it('with baseline', async () => {
      const testVariation = {
        id: '123',
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
      }
      const createTestRequestDto = initCreateTestRequestDto
      const testRunCreateMock = jest.fn()
      const imageName = 'image name'
      const saveImageMock = jest.fn().mockReturnValueOnce(imageName)
      const image = 'image'
      const baseline = 'baseline'
      const getImageMock = jest.fn()
        .mockReturnValueOnce(baseline)
        .mockReturnValueOnce(image)
      service = await initService({ testRunCreateMock, saveImageMock, getImageMock })
      const diff = {
        status: TestStatus.unresolved,
        imageName: 'diff image name',
        pixelMisMatchCount: 11,
        diffPercent: 22,
        isSameDimension: true,
      }
      service.getDiff = jest.fn().mockReturnValueOnce(diff)

      await service.create(testVariation, createTestRequestDto)

      expect(service.getDiff).toHaveBeenCalledWith(baseline, image, createTestRequestDto.diffTollerancePercent, testVariation.ignoreAreas)
      expect(getImageMock).toHaveBeenNthCalledWith(1, testVariation.baselineName)
      expect(getImageMock).toHaveBeenNthCalledWith(2, imageName)
      expect(testRunCreateMock).toHaveBeenCalledWith({
        data: {
          imageName,
          testVariation: {
            connect: {
              id: testVariation.id,
            },
          },
          build: {
            connect: {
              id: createTestRequestDto.buildId,
            },
          },
          name: testVariation.name,
          browser: testVariation.browser,
          device: testVariation.device,
          os: testVariation.os,
          viewport: testVariation.viewport,
          baselineName: testVariation.baselineName,
          ignoreAreas: testVariation.ignoreAreas,
          diffTollerancePercent: createTestRequestDto.diffTollerancePercent,
          diffName: diff.imageName,
          pixelMisMatchCount: diff.pixelMisMatchCount,
          diffPercent: diff.diffPercent,
          status: diff.status,
        }
      })
    })
  })

  describe('getDiff', () => {
    it('diff image dimensions mismatch', async () => {
      const baseline = new PNG({
        width: 10,
        height: 10,
      })
      const image = new PNG({
        width: 20,
        height: 20,
      })
      service = await initService({})

      const result = service.getDiff(baseline, image, 0, '[]')

      expect(result).toStrictEqual({
        status: TestStatus.unresolved,
        imageName: null,
        pixelMisMatchCount: null,
        diffPercent: null,
        isSameDimension: false,
      })
    })

    it('diff not found', async () => {
      const baseline = new PNG({
        width: 10,
        height: 10,
      })
      const image = new PNG({
        width: 10,
        height: 10,
      })
      service = await initService({})
      mocked(Pixelmatch).mockReturnValueOnce(0)

      const result = service.getDiff(baseline, image, 0, '[]')

      expect(result).toStrictEqual({
        status: TestStatus.ok,
        imageName: null,
        pixelMisMatchCount: 0,
        diffPercent: 0,
        isSameDimension: true,
      })
    })

    it('diff found < tollerance', async () => {
      const baseline = new PNG({
        width: 100,
        height: 100,
      })
      const image = new PNG({
        width: 100,
        height: 100,
      })
      const saveImageMock = jest.fn()
      service = await initService({ saveImageMock })
      const pixelMisMatchCount = 150
      mocked(Pixelmatch).mockReturnValueOnce(pixelMisMatchCount)

      const result = service.getDiff(baseline, image, 1.5, '[]')

      expect(saveImageMock).toHaveBeenCalledTimes(0)
      expect(result).toStrictEqual({
        status: TestStatus.ok,
        imageName: null,
        pixelMisMatchCount,
        diffPercent: 1.5,
        isSameDimension: true,
      })
    })

    it('diff found > tollerance', async () => {
      const baseline = new PNG({
        width: 100,
        height: 100,
      })
      const image = new PNG({
        width: 100,
        height: 100,
      })
      const pixelMisMatchCount = 200
      mocked(Pixelmatch).mockReturnValueOnce(pixelMisMatchCount)
      const imageName = 'diff name'
      const saveImageMock = jest.fn().mockReturnValueOnce(imageName)
      service = await initService({
        saveImageMock
      })

      const result = service.getDiff(baseline, image, 1, '[]')

      expect(saveImageMock).toHaveBeenCalledTimes(1)
      expect(result).toStrictEqual({
        status: TestStatus.unresolved,
        imageName,
        pixelMisMatchCount,
        diffPercent: 2,
        isSameDimension: true,
      })
    })
  })
});
