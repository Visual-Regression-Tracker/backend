import { mocked } from 'ts-jest/utils';
import { Test, TestingModule } from '@nestjs/testing';
import { TestRunsService } from './test-runs.service';
import { PrismaService } from '../prisma/prisma.service';
import { StaticService } from '../shared/static/static.service';
import { TestStatus, TestRun, TestVariation } from '@prisma/client';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { TestRunResultDto } from './dto/testRunResult.dto';
import { DiffResult } from './diffResult';
import { EventsGateway } from '../shared/events/events.gateway';
import { CommentDto } from '../shared/dto/comment.dto';
import { TestVariationsService } from '../test-variations/test-variations.service';
import { TestRunDto } from '../test-runs/dto/testRun.dto';
import { BuildsService } from '../builds/builds.service';
import { generateBaseline, generateTestRun, generateTestVariation, TEST_PROJECT } from '../_data_';
import { getTestVariationUniqueData } from '../utils';
import { BaselineDataDto } from '../shared/dto/baseline-data.dto';
import { CompareService } from '../compare/compare.service';
import { CustomTagsDto } from '../shared/dto/custom-tags.dto';

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
  testVariationFindFirstMock = jest.fn(),
  testVariationFindManyMock = jest.fn(),
  baselineCreateMock = jest.fn(),
  testVariationFindOrCreateMock = jest.fn(),
  testVariationGetDetailsMock = jest.fn(),
  testVariationFindUniqueMock = jest.fn(),
  projectFindUniqueMock = jest.fn(),
  compareGetDiffMock = jest.fn(),
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
            findFirst: testVariationFindFirstMock,
            findMany: testVariationFindManyMock,
            findUnique: testVariationFindUniqueMock,
          },
          baseline: {
            create: baselineCreateMock,
          },
          project: {
            findUnique: projectFindUniqueMock,
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
          getDetails: testVariationGetDetailsMock,
        },
      },
      {
        provide: BuildsService,
        useValue: {},
      },
      {
        provide: CompareService,
        useValue: {
          getDiff: compareGetDiffMock,
        },
      },
    ],
  }).compile();

  return module.get<TestRunsService>(TestRunsService);
};
describe('TestRunsService', () => {
  let service: TestRunsService;
  const imageBuffer = Buffer.from('Image');
  const ignoreAreas = [{ x: 1, y: 2, width: 10, height: 20 }];
  const tempIgnoreAreas = [{ x: 3, y: 4, width: 30, height: 40 }];

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

  it('setStatus', async () => {
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

    await service.setStatus(testRun.id, TestStatus.failed);

    expect(testRunUpdateMock).toHaveBeenCalledWith({
      where: { id: testRun.id },
      data: {
        status: TestStatus.failed,
      },
    });
    expect(eventTestRunUpdatedMock).toBeCalledWith(testRun);
  });

  it('create', async () => {
    const initCreateTestRequestDto: CreateTestRequestDto = {
      buildId: 'buildId',
      projectId: 'projectId',
      name: 'Test name',
      os: 'OS',
      browser: 'browser',
      viewport: 'viewport',
      device: 'device',
      customTags: '',
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
      customTags: '',
      ignoreAreas: '[{"x":3,"y":4,"width":500,"height":600}]',
      comment: 'some comment',
      createdAt: new Date(),
      updatedAt: new Date(),
      branchName: 'master',
    };
    const diffResult: DiffResult = {
      status: TestStatus.unresolved,
      diffName: 'diff image name',
      pixelMisMatchCount: 11,
      diffPercent: 22,
      isSameDimension: true,
    };
    const createTestRequestDto = initCreateTestRequestDto;
    const testRunCreateMock = jest.fn().mockResolvedValueOnce(testRun);
    const imageName = 'image name';
    const saveImageMock = jest.fn().mockReturnValueOnce(imageName);
    const image = 'image';
    const baseline = 'baseline';
    const getImageMock = jest.fn().mockReturnValueOnce(baseline).mockReturnValueOnce(image);
    const eventTestRunCreatedMock = jest.fn();
    const compareGetDiffMock = jest.fn().mockReturnValueOnce(diffResult);
    service = await initService({
      testRunCreateMock,
      saveImageMock,
      getImageMock,
      eventTestRunCreatedMock,
      compareGetDiffMock,
    });

    const saveDiffResultMock = jest.fn();
    service.saveDiffResult = saveDiffResultMock.mockResolvedValueOnce(testRunWithResult);
    const tryAutoApproveByPastBaselines = jest.fn();
    service['tryAutoApproveByPastBaselines'] = tryAutoApproveByPastBaselines.mockResolvedValueOnce(testRunWithResult);
    const tryAutoApproveByNewBaselines = jest.fn();
    service['tryAutoApproveByNewBaselines'] = tryAutoApproveByNewBaselines.mockResolvedValueOnce(testRunWithResult);

    const result = await service.create({ testVariation, createTestRequestDto, imageBuffer });

    expect(saveImageMock).toHaveBeenCalledWith('screenshot', imageBuffer);
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
        customTags: testVariation.customTags,
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
    expect(result).toBe(testRun);
  });

  it('calculateDiff', async () => {
    const testRun: TestRun = {
      id: 'id',
      buildId: 'buildId',
      imageName: 'imageName',
      baselineName: 'baselineName',
      diffName: 'diffName',
      diffTollerancePercent: 12,
      diffPercent: 12,
      pixelMisMatchCount: 123,
      status: 'new',
      testVariationId: '3bc4a5bc-006e-4d43-8e4e-eaa132627fca',
      updatedAt: new Date(),
      createdAt: new Date(),
      name: 'ss2f77',
      browser: 'chromium',
      device: null,
      os: null,
      viewport: '1800x1600',
      customTags: '',
      ignoreAreas: JSON.stringify(ignoreAreas),
      tempIgnoreAreas: JSON.stringify(tempIgnoreAreas),
      comment: 'some comment',
      baselineBranchName: 'master',
      branchName: 'develop',
      merge: false,
    };
    const testRunUpdateMock = jest.fn();
    const baselineMock = 'baseline image';
    const imageeMock = 'image';
    const deleteImageMock = jest.fn();
    const diffResult = {
      id: 'test',
    };
    const compareGetDiffMock = jest.fn().mockReturnValueOnce(diffResult);
    service = await initService({
      testRunUpdateMock,
      deleteImageMock,
      compareGetDiffMock,
    });
    service.saveDiffResult = jest.fn();

    await service.calculateDiff('projectId', testRun);

    expect(deleteImageMock).toHaveBeenCalledWith(testRun.diffName);
    expect(compareGetDiffMock).toHaveBeenCalledWith({
      projectId: 'projectId',
      data: {
        image: testRun.imageName,
        baseline: testRun.baselineName,
        ignoreAreas: service['getIgnoteAreas'](testRun),
        diffTollerancePercent: testRun.diffTollerancePercent,
        saveDiffAsFile: true,
      },
    });
    expect(service.saveDiffResult).toHaveBeenCalledWith(testRun.id, diffResult);
  });

  describe('saveDiffResult', () => {
    const testRun: TestRun = {
      id: 'id',
      buildId: 'buildId',
      imageName: 'imageName',
      baselineName: 'baselineName',
      diffName: 'diffName',
      diffTollerancePercent: 12,
      diffPercent: 12,
      pixelMisMatchCount: 123,
      status: 'new',
      testVariationId: '3bc4a5bc-006e-4d43-8e4e-eaa132627fca',
      updatedAt: new Date(),
      createdAt: new Date(),
      name: 'ss2f77',
      browser: 'chromium',
      device: null,
      os: null,
      viewport: '1800x1600',
      customTags: '',
      ignoreAreas: JSON.stringify(ignoreAreas),
      tempIgnoreAreas: JSON.stringify(tempIgnoreAreas),
      comment: 'some comment',
      baselineBranchName: 'master',
      branchName: 'develop',
      merge: false,
    };
    it('no results', async () => {
      const id = 'some id';
      const testRunUpdateMock = jest.fn().mockResolvedValueOnce(testRun);
      const eventTestRunUpdatedMock = jest.fn();
      service = await initService({
        testRunUpdateMock,
        eventTestRunUpdatedMock,
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
      expect(eventTestRunUpdatedMock).toHaveBeenCalledWith(testRun);
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
      const testRunUpdateMock = jest.fn().mockResolvedValueOnce(testRun);
      const eventTestRunUpdatedMock = jest.fn();
      service = await initService({
        testRunUpdateMock,
        eventTestRunUpdatedMock,
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
      expect(eventTestRunUpdatedMock).toHaveBeenCalledWith(testRun);
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
      customTags: '',
      baselineName: null,
      ignoreAreas: '[]',
      tempIgnoreAreas: '[]',
      comment: 'some comment',
      baselineBranchName: 'master',
      branchName: 'develop',
      merge: false,
    };
    const testRunFindManyMock = jest.fn().mockResolvedValueOnce([testRun]);
    service = await initService({
      testRunFindManyMock,
    });

    const result = await service.findMany(buildId);

    expect(testRunFindManyMock).toHaveBeenCalledWith({
      where: { buildId },
    });
    expect(result).toEqual([new TestRunDto(testRun)]);
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
    expect(deleteImageMock).toHaveBeenNthCalledWith(1, testRun.imageName);
    expect(testRunDeleteMock).toHaveBeenCalledWith({
      where: { id },
    });
    expect(eventTestRunDeletedMock).toHaveBeenCalledWith(testRun);
  });

  it('updateIgnoreAreas', async () => {
    const testRun = {
      id: 'testRunId',
      testVariationId: 'testVariationId',
      diffName: 'diffName',
      imageName: 'imageName',
    };
    const testVariation = {
      id: 'testVariationId',
      projectId: 'someProjectId',
    };
    const testRunUpdateMock = jest.fn().mockResolvedValueOnce(testRun);
    const testVariationFindUniqueMock = jest.fn().mockResolvedValueOnce(testVariation);
    service = await initService({
      testRunUpdateMock,
      testVariationFindUniqueMock,
    });
    service.calculateDiff = jest.fn();

    await service.updateIgnoreAreas(testRun.id, ignoreAreas);

    expect(testRunUpdateMock).toHaveBeenCalledWith({
      where: { id: testRun.id },
      data: {
        ignoreAreas: JSON.stringify(ignoreAreas),
      },
    });
    expect(testVariationFindUniqueMock).toHaveBeenCalledWith({
      where: { id: testVariation.id },
    });
    expect(service.calculateDiff).toHaveBeenCalledWith(testVariation.projectId, testRun);
  });

  it('updateComment', async () => {
    const id = 'some id';
    const commentDto: CommentDto = {
      comment: 'random comment',
    };
    const testRunUpdateMock = jest.fn().mockResolvedValueOnce(id);
    const eventTestRunUpdatedMock = jest.fn();
    service = await initService({
      testRunUpdateMock,
      eventTestRunUpdatedMock,
    });

    await service.updateComment(id, commentDto);

    expect(testRunUpdateMock).toHaveBeenCalledWith({
      where: { id },
      data: {
        comment: commentDto.comment,
      },
    });
    expect(eventTestRunUpdatedMock).toHaveBeenCalledWith(id);
  });

  it('update custom tags', async () => {
    const id = 'some id';
    const customTagDto: CustomTagsDto = {
      customTags: 'random tag',
    };
    const testRunUpdateMock = jest.fn().mockResolvedValueOnce(id);
    const eventTestRunUpdatedMock = jest.fn();
    service = await initService({
      testRunUpdateMock,
      eventTestRunUpdatedMock,
    });

    await service.updateCustomTags(id, customTagDto);

    expect(testRunUpdateMock).toHaveBeenCalledWith({
      where: { id },
      data: {
        customTags: customTagDto.customTags,
      },
    });
    expect(eventTestRunUpdatedMock).toHaveBeenCalledWith(id);
  });

  it('postTestRun', async () => {
    const createTestRequestDto: CreateTestRequestDto = {
      buildId: 'buildId',
      projectId: 'projectId',
      name: 'Test name',
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
      customTags: '',
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
      customTags: '',
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
    const projectFindUniqueMock = jest.fn().mockResolvedValueOnce(TEST_PROJECT);
    const testVariationFindOrCreateMock = jest.fn().mockResolvedValueOnce(testVariation);
    const testRunFindManyMock = jest.fn().mockResolvedValueOnce([testRun]);
    const deleteMock = jest.fn();
    const createMock = jest.fn().mockResolvedValueOnce(testRun);
    const service = await initService({
      projectFindUniqueMock,
      testVariationFindOrCreateMock,
      testRunFindManyMock,
    });
    service.delete = deleteMock;
    service.create = createMock;
    service.calculateDiff = jest.fn().mockResolvedValueOnce(testRun);
    service['tryAutoApproveByPastBaselines'] = jest.fn().mockResolvedValueOnce(testRun);
    service['tryAutoApproveByNewBaselines'] = jest.fn().mockResolvedValueOnce(testRun);
    const baselineData: BaselineDataDto = {
      ...getTestVariationUniqueData(createTestRequestDto),
      branchName: createTestRequestDto.branchName,
    };

    await service.postTestRun({ createTestRequestDto, imageBuffer });

    expect(testVariationFindOrCreateMock).toHaveBeenCalledWith(createTestRequestDto.projectId, baselineData);
    expect(testRunFindManyMock).toHaveBeenCalledWith({
      where: {
        buildId: createTestRequestDto.buildId,
        ...baselineData,
        NOT: { OR: [{ status: TestStatus.approved }, { status: TestStatus.autoApproved }] },
      },
    });
    expect(deleteMock).toHaveBeenCalledWith(testRun.id);
    expect(createMock).toHaveBeenCalledWith({ testVariation, createTestRequestDto, imageBuffer });
    expect(service.calculateDiff).toHaveBeenCalledWith(createTestRequestDto.projectId, testRun);
    expect(service['tryAutoApproveByPastBaselines']).toHaveBeenCalledWith({ testVariation, testRun });
    expect(service['tryAutoApproveByNewBaselines']).toHaveBeenCalledWith({ testVariation, testRun });
    expect(mocked(TestRunResultDto)).toHaveBeenCalledWith(testRun, testVariation);
  });

  describe('tryAutoApproveByNewBaselines', () => {
    it('skip if ok', async () => {
      const testRun = generateTestRun({ status: TestStatus.ok });
      service = await initService({});

      const result = await service['tryAutoApproveByNewBaselines']({
        testVariation: generateTestVariation(),
        testRun,
      });

      expect(result).toBe(testRun);
    });

    it('should not auto approve', async () => {
      const testRun = generateTestRun({ status: TestStatus.unresolved });
      const baseline = generateBaseline();
      const testRunFindManyMock = jest.fn().mockResolvedValueOnce([generateTestRun({ status: TestStatus.approved })]);
      const testVariationGetDetailsMock = jest.fn().mockResolvedValueOnce(generateTestVariation({}, [baseline]));
      service = await initService({ testRunFindManyMock, testVariationGetDetailsMock });
      service['shouldAutoApprove'] = jest.fn().mockResolvedValueOnce(false);

      const result = await service['tryAutoApproveByNewBaselines']({
        testVariation: generateTestVariation(),
        testRun,
      });

      expect(service['shouldAutoApprove']).toHaveBeenCalled();
      expect(result).toBe(testRun);
    });

    it('should auto approve', async () => {
      const testRun = generateTestRun({ status: TestStatus.unresolved });
      const baseline = generateBaseline();
      const testRunFindManyMock = jest.fn().mockResolvedValueOnce([generateTestRun({ status: TestStatus.approved })]);
      const testVariationGetDetailsMock = jest.fn().mockResolvedValueOnce(generateTestVariation({}, [baseline]));
      service = await initService({ testRunFindManyMock, testVariationGetDetailsMock });
      service['shouldAutoApprove'] = jest.fn().mockResolvedValueOnce(true);
      service.approve = jest.fn().mockResolvedValueOnce({
        ...testRun,
        status: TestStatus.autoApproved,
      });

      const result = await service['tryAutoApproveByNewBaselines']({
        testVariation: generateTestVariation(),
        testRun,
      });

      expect(result).toStrictEqual({
        ...testRun,
        status: TestStatus.autoApproved,
      });
    });
  });

  describe('tryAutoApproveByPastBaselines', () => {
    it('skip if ok', async () => {
      const testRun = generateTestRun({ status: TestStatus.ok });
      service = await initService({});

      const result = await service['tryAutoApproveByPastBaselines']({
        testVariation: generateTestVariation(),
        testRun,
      });

      expect(result).toBe(testRun);
    });

    it('skip if the branch the same as baseline', async () => {
      const testRun = generateTestRun({ status: TestStatus.unresolved, branchName: 'a', baselineBranchName: 'a' });
      service = await initService({});

      const result = await service['tryAutoApproveByPastBaselines']({
        testVariation: generateTestVariation(),
        testRun,
      });

      expect(result).toBe(testRun);
    });

    it('should not auto approve', async () => {
      const testRun = generateTestRun({ status: TestStatus.unresolved });
      const baseline = generateBaseline();
      const testVariationGetDetailsMock = jest
        .fn()
        .mockResolvedValueOnce(generateTestVariation({}, [baseline, baseline]));
      service = await initService({ testVariationGetDetailsMock });
      service['shouldAutoApprove'] = jest.fn().mockResolvedValueOnce(false);

      const result = await service['tryAutoApproveByPastBaselines']({
        testVariation: generateTestVariation(),
        testRun,
      });

      expect(service['shouldAutoApprove']).toHaveBeenCalled();
      expect(result).toBe(testRun);
    });

    it('should auto approve', async () => {
      const testRun = generateTestRun({ status: TestStatus.unresolved });
      const baseline = generateBaseline();
      const testVariationGetDetailsMock = jest
        .fn()
        .mockResolvedValueOnce(generateTestVariation({}, [baseline, baseline]));
      service = await initService({ testVariationGetDetailsMock });
      service['shouldAutoApprove'] = jest.fn().mockResolvedValueOnce(true);
      service.approve = jest.fn().mockResolvedValueOnce({
        ...testRun,
        status: TestStatus.autoApproved,
      });

      const result = await service['tryAutoApproveByPastBaselines']({
        testVariation: generateTestVariation(),
        testRun,
      });

      expect(result).toStrictEqual({
        ...testRun,
        status: TestStatus.autoApproved,
      });
    });
  });
});
