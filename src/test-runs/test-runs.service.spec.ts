import { mocked } from 'ts-jest/utils';
import { Test, TestingModule } from '@nestjs/testing';
import { TestRunsService } from './test-runs.service';
import { PrismaService } from '../prisma/prisma.service';
import { StaticService } from '../shared/static/static.service';
import { PNG } from 'pngjs';
import { TestStatus, TestRun, TestVariation } from '@prisma/client';
import Pixelmatch from 'pixelmatch';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { TestRunResultDto } from './dto/testRunResult.dto';
import { DiffResult } from './diffResult';
import { IgnoreAreaDto } from './dto/ignore-area.dto';
import { EventsGateway } from '../shared/events/events.gateway';
import { CommentDto } from '../shared/dto/comment.dto';
import { TestVariationsService } from '../test-variations/test-variations.service';
import { convertBaselineDataToQuery } from '../shared/dto/baseline-data.dto';
import { TestRunDto } from './dto/testRun.dto';

jest.mock('pixelmatch');
jest.mock('./dto/testRunResult.dto');

const initService = async ({
  testRunDeleteMock = jest.fn(),
  testRunUpdateMock = jest.fn(),
  testRunFindUniqueMock = jest.fn(),
  testRunFindManyMock = jest.fn(),
  testRunCreateMock = jest.fn(),
  testRunCountMock = jest.fn(),
  getImageMock = jest.fn(),
  saveImageMock = jest.fn(),
  deleteImageMock = jest.fn(),
  eventTestRunUpdatedMock = jest.fn(),
  eventTestRunCreatedMock = jest.fn(),
  eventTestRunDeletedMock = jest.fn(),
  eventBuildUpdatedMock = jest.fn(),
  eventBuildCreatedMock = jest.fn(),
  testVariationCreateMock = jest.fn(),
  testVariationFindManyMock = jest.fn(),
  baselineCreateMock = jest.fn(),
  testVariationFindOrCreateMock = jest.fn(),
  projectFindOneMock = jest.fn(),
}) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TestRunsService,
      {
        provide: PrismaService,
        useValue: {
          testRun: {
            delete: testRunDeleteMock,
            findMany: testRunFindManyMock,
            findUnique: testRunFindUniqueMock,
            create: testRunCreateMock,
            update: testRunUpdateMock,
            count: testRunCountMock,
          },
          testVariation: {
            create: testVariationCreateMock,
            findMany: testVariationFindManyMock,
          },
          baseline: {
            create: baselineCreateMock,
          },
          project: {
            findOne: projectFindOneMock,
          },
        },
      },
      {
        provide: StaticService,
        useValue: {
          getImage: getImageMock,
          saveImage: saveImageMock,
          deleteImage: deleteImageMock,
        },
      },
      {
        provide: EventsGateway,
        useValue: {
          testRunUpdated: eventTestRunUpdatedMock,
          testRunCreated: eventTestRunCreatedMock,
          testRunDeleted: eventTestRunDeletedMock,
          buildUpdated: eventBuildUpdatedMock,
          buildCreated: eventBuildCreatedMock,
        },
      },
      {
        provide: TestVariationsService,
        useValue: {
          findOrCreate: testVariationFindOrCreateMock,
        },
      },
    ],
  }).compile();

  return module.get<TestRunsService>(TestRunsService);
};
describe('TestRunsService', () => {
  let service: TestRunsService;

  it('findOne', async () => {
    const id = 'some id';
    const testRunFindUniqueMock = jest.fn();
    service = await initService({
      testRunFindUniqueMock,
    });

    service.findOne(id);

    expect(testRunFindUniqueMock).toHaveBeenCalledWith({
      where: { id },
      include: {
        testVariation: true,
      },
    });
  });

  it('reject', async () => {
    const testRun = {
      id: 'id',
      imageName: 'imageName',
      diffTollerancePercent: 12,
      status: TestStatus.new,
      buildId: 'buildId',
      testVariationId: 'testVariationId',
      updatedAt: new Date(),
      createdAt: new Date(),
      name: 'test run name',
      ignoreAreas: '[]',
    };
    const testRunUpdateMock = jest.fn().mockResolvedValueOnce(testRun);
    const eventTestRunUpdatedMock = jest.fn();
    service = await initService({
      testRunUpdateMock,
      eventTestRunUpdatedMock,
    });

    await service.reject(testRun.id);

    expect(testRunUpdateMock).toHaveBeenCalledWith({
      where: { id: testRun.id },
      data: {
        status: TestStatus.failed,
      },
    });
    expect(eventTestRunUpdatedMock).toBeCalledWith(testRun);
  });

  describe('approve', () => {
    it('should approve the same branch', async () => {
      const testRun: TestRun = {
        id: 'id',
        imageName: 'imageName',
        diffName: 'diffName',
        baselineName: 'baselineName',
        diffPercent: 1,
        pixelMisMatchCount: 10,
        diffTollerancePercent: 12,
        status: TestStatus.new,
        buildId: 'buildId',
        testVariationId: 'testVariationId',
        updatedAt: new Date(),
        createdAt: new Date(),
        name: 'test run name',
        ignoreAreas: '[]',
        tempIgnoreAreas: '[]',
        browser: 'browser',
        device: 'device',
        os: 'os',
        viewport: 'viewport',
        branchName: 'master',
        baselineBranchName: 'master',
        comment: 'some comment',
        merge: false,
      };
      const testRunUpdateMock = jest.fn().mockResolvedValueOnce({
        ...testRun,
        status: TestStatus.approved,
      });
      const eventTestRunUpdatedMock = jest.fn();
      const testRunFindOneMock = jest.fn().mockResolvedValueOnce(testRun);
      const baselineName = 'some baseline name';
      const saveImageMock = jest.fn().mockReturnValueOnce(baselineName);
      const getImageMock = jest.fn().mockReturnValueOnce(
        new PNG({
          width: 10,
          height: 10,
        })
      );
      service = await initService({
        testRunUpdateMock,
        saveImageMock,
        getImageMock,
        eventTestRunUpdatedMock,
      });
      service.findOne = testRunFindOneMock;

      await service.approve(testRun.id, false);

      expect(testRunFindOneMock).toHaveBeenCalledWith(testRun.id);
      expect(getImageMock).toHaveBeenCalledWith(testRun.imageName);
      expect(saveImageMock).toHaveBeenCalledTimes(1);
      expect(testRunUpdateMock).toHaveBeenCalledWith({
        where: { id: testRun.id },
        data: {
          status: TestStatus.approved,
          testVariation: {
            update: {
              baselineName,
              baselines: {
                create: {
                  baselineName,
                  testRun: {
                    connect: {
                      id: testRun.id,
                    },
                  },
                },
              },
            },
          },
        },
      });
      expect(eventTestRunUpdatedMock).toBeCalledWith({
        ...testRun,
        status: TestStatus.approved,
      });
    });

    it('should approve merge', async () => {
      const testRun: TestRun = {
        id: 'id',
        imageName: 'imageName',
        diffName: 'diffName',
        baselineName: 'baselineName',
        diffPercent: 1,
        pixelMisMatchCount: 10,
        diffTollerancePercent: 12,
        status: TestStatus.new,
        buildId: 'buildId',
        testVariationId: 'testVariationId',
        updatedAt: new Date(),
        createdAt: new Date(),
        name: 'test run name',
        ignoreAreas: '[]',
        tempIgnoreAreas: '[]',
        browser: 'browser',
        device: 'device',
        os: 'os',
        viewport: 'viewport',
        branchName: 'develop',
        baselineBranchName: 'master',
        comment: 'some comment',
        merge: false,
      };
      const testRunUpdateMock = jest.fn().mockResolvedValueOnce({
        ...testRun,
        status: TestStatus.approved,
      });
      const eventTestRunUpdatedMock = jest.fn();
      const testRunFindOneMock = jest.fn().mockResolvedValueOnce(testRun);
      const baselineName = 'some baseline name';
      const saveImageMock = jest.fn().mockReturnValueOnce(baselineName);
      const getImageMock = jest.fn().mockReturnValueOnce(
        new PNG({
          width: 10,
          height: 10,
        })
      );
      service = await initService({
        testRunUpdateMock,
        saveImageMock,
        getImageMock,
        eventTestRunUpdatedMock,
      });
      service.findOne = testRunFindOneMock;

      await service.approve(testRun.id, true);

      expect(testRunFindOneMock).toHaveBeenCalledWith(testRun.id);
      expect(getImageMock).toHaveBeenCalledWith(testRun.imageName);
      expect(saveImageMock).toHaveBeenCalledTimes(1);
      expect(testRunUpdateMock).toHaveBeenCalledWith({
        where: { id: testRun.id },
        data: {
          status: TestStatus.approved,
          testVariation: {
            update: {
              baselineName,
              baselines: {
                create: {
                  baselineName,
                  testRun: {
                    connect: {
                      id: testRun.id,
                    },
                  },
                },
              },
            },
          },
        },
      });
      expect(eventTestRunUpdatedMock).toBeCalledWith({
        ...testRun,
        status: TestStatus.approved,
      });
    });

    it('should approve different branch', async () => {
      const testRun: TestRun & {
        testVariation: TestVariation;
      } = {
        id: 'id',
        imageName: 'imageName',
        diffName: 'diffName',
        baselineName: 'baselineName',
        diffPercent: 1,
        pixelMisMatchCount: 10,
        diffTollerancePercent: 12,
        status: TestStatus.new,
        buildId: 'buildId',
        testVariationId: 'testVariationId',
        updatedAt: new Date(),
        createdAt: new Date(),
        name: 'test run name',
        ignoreAreas: '[]',
        tempIgnoreAreas: '[]',
        browser: 'browser',
        device: 'device',
        os: 'os',
        viewport: 'viewport',
        branchName: 'develop',
        baselineBranchName: 'master',
        comment: 'some comment',
        merge: false,
        testVariation: {
          id: '123',
          projectId: 'project Id',
          name: 'Test name',
          baselineName: 'baselineName',
          os: 'OS',
          browser: 'browser',
          viewport: 'viewport',
          device: 'device',
          ignoreAreas: '[]',
          comment: 'some comment',
          createdAt: new Date(),
          updatedAt: new Date(),
          branchName: 'master',
        },
      };
      const newTestVariation: TestVariation = {
        id: '124',
        projectId: 'project Id',
        name: 'Test name',
        baselineName: 'baselineName',
        os: 'OS',
        browser: 'browser',
        viewport: 'viewport',
        device: 'device',
        ignoreAreas: '[]',
        comment: 'some comment',
        createdAt: new Date(),
        updatedAt: new Date(),
        branchName: 'develop',
      };
      const testRunUpdateMock = jest.fn().mockResolvedValueOnce({
        ...testRun,
        status: TestStatus.approved,
      });
      const eventTestRunUpdatedMock = jest.fn();
      const testRunFindOneMock = jest.fn().mockResolvedValueOnce(testRun);
      const baselineName = 'some baseline name';
      const saveImageMock = jest.fn().mockReturnValueOnce(baselineName);
      const getImageMock = jest.fn().mockReturnValueOnce(
        new PNG({
          width: 10,
          height: 10,
        })
      );
      const testVariationCreateMock = jest.fn().mockResolvedValueOnce(newTestVariation);
      const baselineCreateMock = jest.fn();
      service = await initService({
        testRunUpdateMock,
        saveImageMock,
        getImageMock,
        testVariationCreateMock,
        baselineCreateMock,
        eventTestRunUpdatedMock,
      });
      service.findOne = testRunFindOneMock;

      await service.approve(testRun.id, false);

      expect(testRunFindOneMock).toHaveBeenCalledWith(testRun.id);
      expect(getImageMock).toHaveBeenCalledWith(testRun.imageName);
      expect(saveImageMock).toHaveBeenCalledTimes(1);
      expect(testVariationCreateMock).toBeCalledWith({
        data: {
          project: { connect: { id: testRun.testVariation.projectId } },
          baselineName,
          name: testRun.name,
          browser: testRun.browser,
          device: testRun.device,
          os: testRun.os,
          viewport: testRun.viewport,
          ignoreAreas: testRun.ignoreAreas,
          comment: testRun.comment,
          branchName: testRun.branchName,
        },
      });
      expect(baselineCreateMock).toHaveBeenCalledWith({
        data: {
          baselineName,
          testVariation: {
            connect: { id: newTestVariation.id },
          },
          testRun: {
            connect: {
              id: testRun.id,
            },
          },
        },
      });
      expect(testRunUpdateMock).toHaveBeenCalledWith({
        where: { id: testRun.id },
        data: {
          status: TestStatus.approved,
          testVariation: {
            connect: { id: newTestVariation.id },
          },
        },
      });
      expect(eventTestRunUpdatedMock).toBeCalledWith({
        ...testRun,
        status: TestStatus.approved,
      });
    });
  });

  it('create', async () => {
    const initCreateTestRequestDto: CreateTestRequestDto = {
      buildId: 'buildId',
      projectId: 'projectId',
      name: 'Test name',
      imageBase64: 'Image',
      os: 'OS',
      browser: 'browser',
      viewport: 'viewport',
      device: 'device',
      diffTollerancePercent: undefined,
      branchName: 'develop',
      merge: true,
      ignoreAreas: [
        {
          x: 1,
          y: 2,
          width: 100,
          height: 200,
        },
      ],
    };
    const testRunWithResult = {
      id: 'id',
      imageName: 'imageName',
      baselineName: 'baselineName',
      diffTollerancePercent: 1,
      ignoreAreas: '[]',
      diffName: 'diffName',
      status: TestStatus.unresolved,
    };

    const testRun = {
      id: 'id',
      imageName: 'imageName',
      baselineName: 'baselineName',
      diffTollerancePercent: 1,
      ignoreAreas: '[]',
      diffName: null,
    };
    const testVariation = {
      id: '123',
      projectId: 'project Id',
      name: 'Test name',
      baselineName: 'baselineName',
      os: 'OS',
      browser: 'browser',
      viewport: 'viewport',
      device: 'device',
      ignoreAreas: '[{"x":3,"y":4,"width":500,"height":600}]',
      comment: 'some comment',
      createdAt: new Date(),
      updatedAt: new Date(),
      branchName: 'master',
    };
    const createTestRequestDto = initCreateTestRequestDto;
    const testRunCreateMock = jest.fn().mockResolvedValueOnce(testRun);
    const imageName = 'image name';
    const saveImageMock = jest.fn().mockReturnValueOnce(imageName);
    const image = 'image';
    const baseline = 'baseline';
    const getImageMock = jest.fn().mockReturnValueOnce(baseline).mockReturnValueOnce(image);
    const eventTestRunCreatedMock = jest.fn();
    service = await initService({ testRunCreateMock, saveImageMock, getImageMock, eventTestRunCreatedMock });
    const diffResult: DiffResult = {
      status: TestStatus.unresolved,
      diffName: 'diff image name',
      pixelMisMatchCount: 11,
      diffPercent: 22,
      isSameDimension: true,
    };
    const getDiffMock = jest.fn().mockReturnValueOnce(diffResult);
    service.getDiff = getDiffMock;
    const saveDiffResultMock = jest.fn();
    service.saveDiffResult = saveDiffResultMock.mockResolvedValueOnce(testRunWithResult);
    const tryAutoApproveByPastBaselines = jest.fn();
    service['tryAutoApproveByPastBaselines'] = tryAutoApproveByPastBaselines.mockResolvedValueOnce(testRunWithResult);
    const tryAutoApproveByNewBaselines = jest.fn();
    service['tryAutoApproveByNewBaselines'] = tryAutoApproveByNewBaselines.mockResolvedValueOnce(testRunWithResult);

    const result = await service.create(testVariation, createTestRequestDto);

    expect(saveImageMock).toHaveBeenCalledWith('screenshot', Buffer.from(createTestRequestDto.imageBase64, 'base64'));
    expect(getImageMock).toHaveBeenNthCalledWith(1, testVariation.baselineName);
    expect(getImageMock).toHaveBeenNthCalledWith(2, imageName);
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
        tempIgnoreAreas: JSON.stringify(createTestRequestDto.ignoreAreas),
        comment: testVariation.comment,
        baselineBranchName: testVariation.branchName,
        branchName: createTestRequestDto.branchName,
        diffTollerancePercent: createTestRequestDto.diffTollerancePercent,
        merge: createTestRequestDto.merge,
        status: TestStatus.new,
      },
    });
    expect(getDiffMock).toHaveBeenCalledWith(baseline, image, testRun.diffTollerancePercent, [
      {
        x: 3,
        y: 4,
        width: 500,
        height: 600,
      },
      {
        x: 1,
        y: 2,
        width: 100,
        height: 200,
      },
    ]);
    expect(saveDiffResultMock).toHaveBeenCalledWith(testRun.id, diffResult);
    expect(tryAutoApproveByPastBaselines).toHaveBeenCalledWith(testVariation, testRunWithResult, [
      {
        x: 3,
        y: 4,
        width: 500,
        height: 600,
      },
      {
        x: 1,
        y: 2,
        width: 100,
        height: 200,
      },
    ]);
    expect(tryAutoApproveByNewBaselines).toHaveBeenCalledWith(testVariation, testRunWithResult, [
      {
        x: 3,
        y: 4,
        width: 500,
        height: 600,
      },
      {
        x: 1,
        y: 2,
        width: 100,
        height: 200,
      },
    ]);
    expect(eventTestRunCreatedMock).toHaveBeenCalledWith(testRunWithResult);
    expect(result).toBe(testRunWithResult);
  });

  describe('getDiff', () => {
    it('no baseline', async () => {
      const baseline = null;
      const image = new PNG({
        width: 20,
        height: 20,
      });
      service = await initService({});

      const result = service.getDiff(baseline, image, 0, []);

      expect(result).toStrictEqual({
        status: undefined,
        diffName: null,
        pixelMisMatchCount: undefined,
        diffPercent: undefined,
        isSameDimension: undefined,
      });
    });

    it('diff image dimensions mismatch', async () => {
      const baseline = new PNG({
        width: 10,
        height: 10,
      });
      const image = new PNG({
        width: 20,
        height: 20,
      });
      service = await initService({});

      const result = service.getDiff(baseline, image, 0, []);

      expect(result).toStrictEqual({
        status: TestStatus.unresolved,
        diffName: null,
        pixelMisMatchCount: undefined,
        diffPercent: undefined,
        isSameDimension: false,
      });
    });

    it('diff not found', async () => {
      const baseline = new PNG({
        width: 10,
        height: 10,
      });
      const image = new PNG({
        width: 10,
        height: 10,
      });
      service = await initService({});
      mocked(Pixelmatch).mockReturnValueOnce(0);

      const result = service.getDiff(baseline, image, 0, []);

      expect(result).toStrictEqual({
        status: TestStatus.ok,
        diffName: null,
        pixelMisMatchCount: 0,
        diffPercent: 0,
        isSameDimension: true,
      });
    });

    it('diff found < tollerance', async () => {
      const baseline = new PNG({
        width: 100,
        height: 100,
      });
      const image = new PNG({
        width: 100,
        height: 100,
      });
      const saveImageMock = jest.fn();
      service = await initService({ saveImageMock });
      const pixelMisMatchCount = 150;
      mocked(Pixelmatch).mockReturnValueOnce(pixelMisMatchCount);

      const result = service.getDiff(baseline, image, 1.5, []);

      expect(saveImageMock).toHaveBeenCalledTimes(0);
      expect(result).toStrictEqual({
        status: TestStatus.ok,
        diffName: null,
        pixelMisMatchCount,
        diffPercent: 1.5,
        isSameDimension: true,
      });
    });

    it('diff found > tollerance', async () => {
      const baseline = new PNG({
        width: 100,
        height: 100,
      });
      const image = new PNG({
        width: 100,
        height: 100,
      });
      const pixelMisMatchCount = 200;
      mocked(Pixelmatch).mockReturnValueOnce(pixelMisMatchCount);
      const diffName = 'diff name';
      const saveImageMock = jest.fn().mockReturnValueOnce(diffName);
      service = await initService({
        saveImageMock,
      });

      const result = service.getDiff(baseline, image, 1, []);

      expect(saveImageMock).toHaveBeenCalledTimes(1);
      expect(result).toStrictEqual({
        status: TestStatus.unresolved,
        diffName,
        pixelMisMatchCount,
        diffPercent: 2,
        isSameDimension: true,
      });
    });
  });

  it('recalculateDiff', async () => {
    const testRun = {
      id: 'id',
      buildId: 'buildId',
      imageName: 'imageName',
      baselineName: 'baselineName',
      diffTollerancePercent: 12,
      ignoreAreas: '[]',
      diffName: null,
    };
    const testRunFindOneMock = jest.fn().mockResolvedValueOnce(testRun);
    const testRunUpdateMock = jest.fn();
    const eventTestRunUpdatedMock = jest.fn();
    const baselineMock = 'baseline image';
    const imageeMock = 'image';
    const getImageMock = jest.fn().mockReturnValueOnce(baselineMock).mockReturnValueOnce(imageeMock);
    const deleteImageMock = jest.fn();
    const diffResult = {
      id: 'test',
    };
    const getDiffMock = jest.fn().mockReturnValue(diffResult);
    service = await initService({
      testRunUpdateMock,
      eventTestRunUpdatedMock,
      getImageMock,
      deleteImageMock,
    });
    service.findOne = testRunFindOneMock;
    service.getDiff = getDiffMock;

    await service.recalculateDiff(testRun.id);

    expect(testRunFindOneMock).toHaveBeenCalledWith(testRun.id);
    expect(getImageMock).toHaveBeenNthCalledWith(1, testRun.baselineName);
    expect(getImageMock).toHaveBeenNthCalledWith(2, testRun.imageName);
    expect(deleteImageMock).toHaveBeenCalledWith(testRun.diffName);
    expect(getDiffMock).toHaveBeenCalledWith(
      baselineMock,
      imageeMock,
      testRun.diffTollerancePercent,
      JSON.parse(testRun.ignoreAreas)
    );
    expect(eventTestRunUpdatedMock).toBeCalledWith(testRun);
  });

  describe('saveDiffResult', () => {
    it('no results', async () => {
      const id = 'some id';
      const testRunUpdateMock = jest.fn();
      service = await initService({
        testRunUpdateMock,
      });

      await service.saveDiffResult(id, null);

      expect(testRunUpdateMock).toHaveBeenCalledWith({
        where: { id },
        data: {
          status: TestStatus.new,
          diffName: null,
          pixelMisMatchCount: null,
          diffPercent: null,
        },
      });
    });

    it('with results', async () => {
      const diff: DiffResult = {
        status: TestStatus.unresolved,
        diffName: 'diff image name',
        pixelMisMatchCount: 11,
        diffPercent: 22,
        isSameDimension: true,
      };
      const id = 'some id';
      const testRunUpdateMock = jest.fn();
      service = await initService({
        testRunUpdateMock,
      });

      await service.saveDiffResult(id, diff);

      expect(testRunUpdateMock).toHaveBeenCalledWith({
        where: { id },
        data: {
          status: diff.status,
          diffName: diff.diffName,
          pixelMisMatchCount: diff.pixelMisMatchCount,
          diffPercent: diff.diffPercent,
        },
      });
    });
  });

  it('findMany', async () => {
    const buildId = 'some id';
    const testRun: TestRun = {
      id: '10fb5e02-64e0-4cf5-9f17-c00ab3c96658',
      imageName: '1592423768112.screenshot.png',
      diffName: 'diffName',
      diffPercent: 12,
      diffTollerancePercent: 1,
      pixelMisMatchCount: 123,
      status: 'new',
      buildId: buildId,
      testVariationId: '3bc4a5bc-006e-4d43-8e4e-eaa132627fca',
      updatedAt: new Date(),
      createdAt: new Date(),
      name: 'ss2f77',
      browser: 'chromium',
      device: null,
      os: null,
      viewport: '1800x1600',
      baselineName: null,
      ignoreAreas: '[]',
      tempIgnoreAreas: '[]',
      comment: 'some comment',
      baselineBranchName: 'master',
      branchName: 'develop',
      merge: false,
    };
    const testRunFindManyMock = jest.fn().mockResolvedValueOnce([testRun]);
    const testRunCountMock = jest.fn().mockResolvedValueOnce(30);
    service = await initService({
      testRunFindManyMock,
      testRunCountMock,
    });

    const result = await service.findMany(buildId, 10, 1);

    expect(testRunFindManyMock).toHaveBeenCalledWith({
      where: { buildId },
      take: 10,
      skip: 1,
    });
    expect(testRunCountMock).toHaveBeenCalledWith({
      where: { buildId },
    });
    expect(result).toEqual({
      data: [new TestRunDto(testRun)],
      take: 10,
      skip: 1,
      total: 30,
    });
  });

  it('delete', async () => {
    const id = 'some id';
    const testRun = {
      diffName: 'diffName',
      imageName: 'imageName',
    };
    const findOneMock = jest.fn().mockResolvedValueOnce(testRun);
    const deleteImageMock = jest.fn();
    const testRunDeleteMock = jest.fn();
    const eventTestRunDeletedMock = jest.fn();
    service = await initService({
      deleteImageMock,
      testRunDeleteMock,
      eventTestRunDeletedMock,
    });
    service.findOne = findOneMock;

    await service.delete(id);

    expect(findOneMock).toHaveBeenCalledWith(id);
    expect(deleteImageMock).toHaveBeenNthCalledWith(1, testRun.diffName);
    expect(deleteImageMock).toHaveBeenNthCalledWith(2, testRun.imageName);
    expect(testRunDeleteMock).toHaveBeenCalledWith({
      where: { id },
    });
    expect(eventTestRunDeletedMock).toHaveBeenCalledWith(testRun);
  });

  it('updateIgnoreAreas', async () => {
    const id = 'some id';
    const ignoreAreas: IgnoreAreaDto[] = [{ x: 1, y: 2, width: 10, height: 20 }];
    const testRunUpdateMock = jest.fn();
    service = await initService({
      testRunUpdateMock,
    });

    await service.updateIgnoreAreas(id, ignoreAreas);

    expect(testRunUpdateMock).toHaveBeenCalledWith({
      where: { id },
      data: {
        ignoreAreas: JSON.stringify(ignoreAreas),
      },
    });
  });

  it('updateComment', async () => {
    const id = 'some id';
    const commentDto: CommentDto = {
      comment: 'random comment',
    };
    const testRunUpdateMock = jest.fn();
    service = await initService({
      testRunUpdateMock,
    });

    await service.updateComment(id, commentDto);

    expect(testRunUpdateMock).toHaveBeenCalledWith({
      where: { id },
      data: {
        comment: commentDto.comment,
      },
    });
  });

  it('postTestRun', async () => {
    const createTestRequestDto: CreateTestRequestDto = {
      buildId: 'buildId',
      projectId: 'projectId',
      name: 'Test name',
      imageBase64: 'Image',
      os: 'OS',
      browser: 'browser',
      viewport: 'viewport',
      device: 'device',
      branchName: 'develop',
    };
    const testVariation: TestVariation = {
      id: '123',
      projectId: 'project Id',
      name: 'Test name',
      baselineName: 'baselineName',
      os: 'OS',
      browser: 'browser',
      viewport: 'viewport',
      device: 'device',
      ignoreAreas: '[]',
      comment: 'some comment',
      createdAt: new Date(),
      updatedAt: new Date(),
      branchName: 'master',
    };
    const testRun: TestRun = {
      id: '10fb5e02-64e0-4cf5-9f17-c00ab3c96658',
      imageName: '1592423768112.screenshot.png',
      diffName: 'diffName',
      diffPercent: 12,
      diffTollerancePercent: 1,
      pixelMisMatchCount: 123,
      status: 'new',
      buildId: '146e7a8d-89f0-4565-aa2c-e61efabb0afd',
      testVariationId: '3bc4a5bc-006e-4d43-8e4e-eaa132627fca',
      updatedAt: new Date(),
      createdAt: new Date(),
      name: 'ss2f77',
      browser: 'chromium',
      device: null,
      os: null,
      viewport: '1800x1600',
      baselineName: null,
      ignoreAreas: '[]',
      tempIgnoreAreas: '[]',
      comment: 'some comment',
      baselineBranchName: 'master',
      branchName: 'develop',
      merge: false,
    };
    const testVariationFindOrCreateMock = jest.fn().mockResolvedValueOnce(testVariation);
    const testRunFindManyMock = jest.fn().mockResolvedValueOnce([testRun]);
    const deleteMock = jest.fn();
    const createMock = jest.fn().mockResolvedValueOnce(testRun);
    const service = await initService({
      testVariationFindOrCreateMock,
      testRunFindManyMock,
    });
    service.delete = deleteMock;
    service.create = createMock;
    const baselineData = convertBaselineDataToQuery(createTestRequestDto);

    await service.postTestRun(createTestRequestDto);

    expect(testVariationFindOrCreateMock).toHaveBeenCalledWith(createTestRequestDto.projectId, baselineData);
    expect(testRunFindManyMock).toHaveBeenCalledWith({
      where: {
        buildId: createTestRequestDto.buildId,
        ...baselineData,
      },
    });
    expect(deleteMock).toHaveBeenCalledWith(testRun.id);
    expect(createMock).toHaveBeenCalledWith(testVariation, createTestRequestDto);
    expect(mocked(TestRunResultDto)).toHaveBeenCalledWith(testRun, testVariation);
  });
});
