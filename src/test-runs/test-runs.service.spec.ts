import { NotFoundException } from '@nestjs/common';
import { mocked } from 'jest-mock';
import { Test, TestingModule } from '@nestjs/testing';
import { SIGNATURE_CONCURRENCY, TestRunsService } from './test-runs.service';
import { SIGNATURE_LENGTH } from '../compare/libs/pixelmatch/signature.core';
import { PrismaService } from '../prisma/prisma.service';
import { StaticService } from '../static/static.service';
import { Prisma, TestStatus, TestRun, TestVariation } from '@prisma/client';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { TestRunResultDto } from './dto/testRunResult.dto';
import { DiffResult } from './diffResult';
import { EventsGateway } from '../shared/events/events.gateway';
import { TestVariationsService } from '../test-variations/test-variations.service';
import { TestRunDto } from '../test-runs/dto/testRun.dto';
import { BuildsService } from '../builds/builds.service';
import { generateBaseline, generateTestRun, generateTestVariation, TEST_PROJECT } from '../_data_';
import { getTestVariationUniqueData } from '../utils';
import { BaselineDataDto } from '../shared/dto/baseline-data.dto';
import { CompareService } from '../compare/compare.service';
import { UpdateTestRunDto } from './dto/update-test.dto';

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
  testVariationFindMock = jest.fn(),
  testVariationUpdateMock = jest.fn(),
  testVariationGetDetailsMock = jest.fn(),
  testVariationFindUniqueMock = jest.fn(),
  projectFindUniqueMock = jest.fn(),
  compareGetDiffMock = jest.fn(),
  compareGetChangeSignatureMock = jest.fn(),
  getImageBufferMock = jest.fn(),
  copyImageMock = jest.fn(),
  testVariationServiceCreateMock = jest.fn(),
  testVariationServiceFindUniqueMock = jest.fn(),
  testVariationAddBaselineMock = jest.fn(),
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
          getImageBuffer: getImageBufferMock,
          copyImage: copyImageMock,
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
          find: testVariationFindMock,
          getDetails: testVariationGetDetailsMock,
          update: testVariationUpdateMock,
          create: testVariationServiceCreateMock,
          findUnique: testVariationServiceFindUniqueMock,
          addBaseline: testVariationAddBaselineMock,
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
          getChangeSignature: compareGetChangeSignatureMock,
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
    expect(eventTestRunUpdatedMock).toHaveBeenCalledWith(testRun);
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
      diffName: null as string | null,
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
        project: {
          connect: {
            id: createTestRequestDto.projectId,
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
    const testRun: TestRun = generateTestRun();
    const testRunUpdateMock = jest.fn();
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
        ignoreAreas: service['getAllIgnoteAreas'](testRun),
        diffTollerancePercent: testRun.diffTollerancePercent,
        saveDiffAsFile: true,
      },
    });
    expect(service.saveDiffResult).toHaveBeenCalledWith(testRun.id, diffResult);
  });

  describe('saveDiffResult', () => {
    const testRun: TestRun = generateTestRun();
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
          vlmDescription: null,
          changeSignature: null,
          imageThumbnailName: null,
          diffThumbnailName: null,
        },
      });
      expect(eventTestRunUpdatedMock).toHaveBeenCalledWith(testRun);
    });

    // Written here, next to the diff that decoded the screenshots anyway, so
    // the variations dialog never has to decode them again.
    it('stores the change signature the comparison produced', async () => {
      const testRunUpdateMock = jest.fn().mockResolvedValueOnce(testRun);
      service = await initService({ testRunUpdateMock });

      await service.saveDiffResult('some id', {
        status: TestStatus.unresolved,
        diffName: 'diff image name',
        pixelMisMatchCount: 11,
        diffPercent: 22,
        isSameDimension: true,
        changeSignature: { threshold: 0.1, includeAA: true, signature: [0.25, 0.75] },
      });

      expect(testRunUpdateMock.mock.calls[0][0].data).toMatchObject({
        changeSignature: JSON.stringify({ threshold: 0.1, includeAA: true, signature: [0.25, 0.75] }),
      });
    });

    it('stores no signature when the comparison produced none', async () => {
      const testRunUpdateMock = jest.fn().mockResolvedValueOnce(testRun);
      service = await initService({ testRunUpdateMock });

      await service.saveDiffResult('some id', {
        status: TestStatus.ok,
        diffName: null,
        pixelMisMatchCount: 0,
        diffPercent: 0,
        isSameDimension: true,
      });

      expect(testRunUpdateMock.mock.calls[0][0].data).toMatchObject({ changeSignature: null });
    });

    it('with results', async () => {
      const diff: DiffResult = {
        status: TestStatus.unresolved,
        diffName: 'diff image name',
        pixelMisMatchCount: 11,
        diffPercent: 22,
        isSameDimension: true,
        vlmDescription: 'VLM detected significant color differences in the header section',
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
          vlmDescription: diff.vlmDescription,
          changeSignature: null,
          imageThumbnailName: null,
          diffThumbnailName: null,
        },
      });
      expect(eventTestRunUpdatedMock).toHaveBeenCalledWith(testRun);
    });
  });

  it('findMany', async () => {
    const buildId = 'some id';
    const testRun: TestRun = generateTestRun({
      vlmDescription: 'VLM analysis completed',
    });
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
    expect(deleteImageMock).toHaveBeenNthCalledWith(1, testRun.diffName);
    expect(deleteImageMock).toHaveBeenNthCalledWith(2, testRun.imageName);
    expect(testRunDeleteMock).toHaveBeenCalledWith({
      where: { id },
    });
    expect(eventTestRunDeletedMock).toHaveBeenCalledWith(testRun);
  });

  it('delete not found', async () => {
    const id = 'some id';
    const findOneMock = jest.fn().mockResolvedValueOnce(undefined);
    const deleteImageMock = jest.fn();
    const testRunDeleteMock = jest.fn();
    const eventTestRunDeletedMock = jest.fn();
    service = await initService({
      deleteImageMock,
      testRunDeleteMock,
      eventTestRunDeletedMock,
    });
    service.findOne = findOneMock;

    const result = await service.delete(id);

    expect(deleteImageMock).not.toHaveBeenCalled();
    expect(testRunDeleteMock).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('updateIgnoreAreas', async () => {
    const testRun = {
      id: 'testRunId',
      testVariationId: 'testVariationId',
      diffName: 'diffName',
      imageName: 'imageName',
      ignoreAreas: JSON.stringify(ignoreAreas),
    };
    const testVariation = {
      id: 'testVariationId',
      projectId: 'someProjectId',
    };
    const testRunUpdateMock = jest.fn().mockResolvedValueOnce(testRun);
    const testVariationUpdateMock = jest.fn().mockResolvedValueOnce(testVariation);
    service = await initService({
      testRunUpdateMock,
      testVariationUpdateMock,
    });
    service.calculateDiff = jest.fn();

    await service.updateIgnoreAreas(testRun.id, ignoreAreas);

    expect(testRunUpdateMock).toHaveBeenCalledWith({
      where: { id: testRun.id },
      data: {
        ignoreAreas: JSON.stringify(ignoreAreas),
      },
    });
    expect(testVariationUpdateMock).toHaveBeenCalledWith(testRun.testVariationId, {
      ignoreAreas: testRun.ignoreAreas,
    });
    expect(service.calculateDiff).toHaveBeenCalledWith(testVariation.projectId, testRun);
  });

  it('update', async () => {
    const testRun = {
      id: 'testRunId',
      testVariationId: 'testVariationId',
      diffName: 'diffName',
      imageName: 'imageName',
    };
    const data: UpdateTestRunDto = {
      comment: 'random comment',
    };
    const testRunUpdateMock = jest.fn().mockResolvedValueOnce(testRun);
    const testVariationUpdateMock = jest.fn();
    const eventTestRunUpdatedMock = jest.fn();
    service = await initService({
      testRunUpdateMock,
      eventTestRunUpdatedMock,
      testVariationUpdateMock,
    });

    await service.update(testRun.id, data);

    expect(testRunUpdateMock).toHaveBeenCalledWith({
      where: { id: testRun.id },
      data: {
        comment: data.comment,
      },
    });
    expect(testVariationUpdateMock).toHaveBeenCalledWith(testRun.testVariationId, data);
    expect(eventTestRunUpdatedMock).toHaveBeenCalledWith(testRun);
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
      customTags: 'customTags',
      comment: 'new comment',
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
    const testRun: TestRun = generateTestRun();
    const projectFindUniqueMock = jest.fn().mockResolvedValueOnce(TEST_PROJECT);
    const testVariationFindMock = jest.fn().mockResolvedValueOnce(testVariation);
    const testRunFindManyMock = jest.fn().mockResolvedValueOnce([testRun]);
    const deleteMock = jest.fn();
    const createMock = jest.fn().mockResolvedValueOnce(testRun);
    const service = await initService({
      projectFindUniqueMock,
      testVariationFindMock,
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

    expect(testVariationFindMock).toHaveBeenCalledWith(createTestRequestDto);
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

  describe('thumbnails', () => {
    it('stores the names the comparison saved them under', async () => {
      const testRunUpdateMock = jest.fn().mockResolvedValueOnce(generateTestRun());
      service = await initService({ testRunUpdateMock });

      await service.saveDiffResult('some id', {
        status: TestStatus.unresolved,
        diffName: 'diff.png',
        pixelMisMatchCount: 11,
        diffPercent: 22,
        isSameDimension: true,
        imageThumbnailName: 'image.thumb.png',
        diffThumbnailName: 'diff.thumb.png',
      });

      expect(testRunUpdateMock.mock.calls[0][0].data).toMatchObject({
        imageThumbnailName: 'image.thumb.png',
        diffThumbnailName: 'diff.thumb.png',
      });
    });

    // Recalculating replaces the names on the row, so whatever they pointed at
    // before has to go with the old diff — otherwise every ignore-area edit
    // leaves two more objects nothing references.
    it('removes the previous ones when the diff is recalculated', async () => {
      const testRun = generateTestRun({
        diffName: 'old-diff.png',
        imageThumbnailName: 'old-image.thumb.png',
        diffThumbnailName: 'old-diff.thumb.png',
      });
      const deleteImageMock = jest.fn();
      service = await initService({
        deleteImageMock,
        compareGetDiffMock: jest.fn().mockResolvedValueOnce({ status: TestStatus.ok }),
        testRunUpdateMock: jest.fn().mockResolvedValueOnce(testRun),
      });

      await service.calculateDiff('projectId', testRun);

      expect(deleteImageMock.mock.calls.map(([name]) => name).sort()).toEqual(
        ['old-diff.png', 'old-diff.thumb.png', 'old-image.thumb.png'].sort()
      );
    });

    // Deleting before the replacement exists means a failed comparison leaves
    // the row pointing at files that are gone — the reviewer opens the run and
    // sees broken pictures, with nothing to recover from.
    it('keeps the previous ones when the comparison fails', async () => {
      const testRun = generateTestRun({
        diffName: 'old-diff.png',
        imageThumbnailName: 'old-image.thumb.png',
        diffThumbnailName: 'old-diff.thumb.png',
      });
      const deleteImageMock = jest.fn();
      service = await initService({
        deleteImageMock,
        compareGetDiffMock: jest.fn().mockRejectedValueOnce(new Error('storage is down')),
      });

      await expect(service.calculateDiff('projectId', testRun)).rejects.toThrow('storage is down');

      expect(deleteImageMock).not.toHaveBeenCalled();
    });

    // two extra objects per run: left behind on delete they would outlive every
    // build that ever referenced them, and nothing would ever collect them
    it('removes them with the run they belong to', async () => {
      const testRun = generateTestRun({
        imageName: 'image.png',
        diffName: 'diff.png',
        imageThumbnailName: 'image.thumb.png',
        diffThumbnailName: 'diff.thumb.png',
      });
      const deleteImageMock = jest.fn();
      service = await initService({
        testRunFindUniqueMock: jest.fn().mockResolvedValueOnce(testRun),
        testRunDeleteMock: jest.fn().mockResolvedValueOnce(testRun),
        deleteImageMock,
      });

      await service.delete(testRun.id);

      expect(deleteImageMock.mock.calls.map(([name]) => name).sort()).toEqual(
        ['diff.png', 'diff.thumb.png', 'image.png', 'image.thumb.png'].sort()
      );
    });
  });

  describe('getMatchingVariations', () => {
    // Full-length histograms, because a stored one is only reused when its shape
    // matches what this build produces. Orthogonal, so they never match.
    const histogram = (hot: number): number[] =>
      Array.from({ length: SIGNATURE_LENGTH }, (_unused, index) => (index === hot ? 1 : 0));
    const SAME_PALETTE = histogram(0);
    const OTHER_PALETTE = histogram(SIGNATURE_LENGTH - 1);

    // A sibling of the reviewed screen. imageName doubles as the run's identity
    // in the signature mocks below, which see buffers rather than runs.
    const sibling = (id: string, overrides: Partial<TestRun> = {}): TestRun =>
      generateTestRun({
        id,
        status: TestStatus.unresolved,
        name: 'Screen A',
        baselineName: `${id}.baseline.png`,
        imageName: `${id}.screenshot.png`,
        customTags: id,
        diffPercent: 12,
        ...overrides,
      });

    // The pool takes PNG bytes, so the fake static service hands back the image
    // name as its own content and the signature mock reads the name back out.
    const initMatchingService = async ({
      testRun,
      siblings,
      signatureOf,
    }: {
      testRun: TestRun;
      siblings: TestRun[];
      signatureOf: (imageName: string) => Promise<number[] | null> | number[] | null;
    }) => {
      const compareGetChangeSignatureMock = jest.fn().mockImplementation(async (input) => ({
        signature: await signatureOf(input.image.toString()),
      }));
      const built = await initService({
        testRunFindUniqueMock: jest.fn().mockResolvedValue({ ...testRun, testVariation: generateTestVariation() }),
        testRunFindManyMock: jest.fn().mockResolvedValue(siblings),
        projectFindUniqueMock: jest
          .fn()
          .mockResolvedValue({ bulkApproveVariations: true, bulkApproveGroupBy: 'customTags' }),
        getImageBufferMock: jest.fn().mockImplementation(async (name: string) => Buffer.from(name)),
        compareGetChangeSignatureMock,
      });
      return { service: built, compareGetChangeSignatureMock };
    };

    it('matches same-palette, same-size siblings and skips different pattern / far larger change', async () => {
      const testRun = sibling('target', { customTags: '' });
      const matching = sibling('locale-a');
      const bigger = sibling('locale-b', { diffPercent: 30 });
      const different = sibling('locale-c');

      const built = await initMatchingService({
        testRun,
        siblings: [matching, bigger, different],
        signatureOf: (imageName) => (imageName.startsWith('locale-c') ? OTHER_PALETTE : SAME_PALETTE),
      });

      const result = await built.service.getMatchingVariations(testRun.id);

      expect(result.variations.map((variation) => variation.id)).toEqual([testRun.id, matching.id]);
      expect(result.skipped.map((item) => ({ id: item.id, reason: item.reason }))).toEqual([
        { id: bigger.id, reason: 'different change size' },
        { id: different.id, reason: 'different change pattern' },
      ]);
    });

    // The whole point of storing it: a build's screenshots are fetched and
    // decoded once at ingest, never again to group a screen at review time.
    it('groups from the signatures stored at ingest, without decoding anything', async () => {
      const signed = (id: string, signature: number[], overrides = {}) =>
        sibling(id, {
          changeSignature: JSON.stringify({ threshold: 0.1, includeAA: true, signature }),
          ...overrides,
        });
      const testRun = signed('target', SAME_PALETTE, { customTags: '' });
      const matching = signed('locale-a', SAME_PALETTE);
      const different = signed('locale-c', OTHER_PALETTE);

      const built = await initMatchingService({
        testRun,
        siblings: [matching, different],
        signatureOf: () => {
          throw new Error('should not be computing a signature');
        },
      });

      const result = await built.service.getMatchingVariations(testRun.id);

      expect(built.compareGetChangeSignatureMock).not.toHaveBeenCalled();
      expect(result.variations.map((variation) => variation.id)).toEqual([testRun.id, matching.id]);
      expect(result.skipped.map((item) => item.reason)).toEqual(['different change pattern']);
    });

    // A signature only means anything under the threshold it was computed with.
    // The in-memory memo has always keyed on that; the stored one has to too,
    // or changing a project's comparison config silently mixes signatures from
    // two different settings and grouping quietly gets worse.
    it('recomputes when the project config has moved on since ingest', async () => {
      const stale = JSON.stringify({ threshold: 0.9, includeAA: false, signature: SAME_PALETTE });
      const testRun = sibling('target', { customTags: '', changeSignature: stale });
      const matching = sibling('locale-a', { changeSignature: stale });

      const built = await initMatchingService({
        testRun,
        siblings: [matching],
        signatureOf: () => SAME_PALETTE,
      });

      const result = await built.service.getMatchingVariations(testRun.id);

      const asked = built.compareGetChangeSignatureMock.mock.calls.map(([input]) => input.image.toString());
      expect(asked.sort()).toEqual([testRun.imageName, matching.imageName].sort());
      expect(result.variations.map((variation) => variation.id)).toEqual([testRun.id, matching.id]);
    });

    // A signature is a fixed-length histogram. One of the wrong length compared
    // against one of the right length gives a similarity score computed over
    // undefined entries — a number, silently meaningless. The same self-
    // invalidating guard as the config stamp: if the shape moves on, recompute.
    it.each([
      ['the wrong length', [1, 0]],
      ['values that are not numbers', new Array(SIGNATURE_LENGTH).fill('nope')],
    ])('recomputes a stored signature with %s', async (_case, signature) => {
      const stored = JSON.stringify({ threshold: 0.1, includeAA: true, signature });
      const testRun = sibling('target', { customTags: '', changeSignature: stored });

      const built = await initMatchingService({
        testRun,
        siblings: [],
        signatureOf: () => SAME_PALETTE,
      });

      await built.service.getMatchingVariations(testRun.id);

      expect(built.compareGetChangeSignatureMock).toHaveBeenCalled();
    });

    // builds ingested before the column existed, and runs compared by something
    // other than pixelmatch, still have to group
    it('falls back to computing for a run with nothing stored', async () => {
      const testRun = sibling('target', {
        customTags: '',
        changeSignature: JSON.stringify({ threshold: 0.1, includeAA: true, signature: SAME_PALETTE }),
      });
      const unsigned = sibling('locale-a');

      const built = await initMatchingService({
        testRun,
        siblings: [unsigned],
        signatureOf: () => SAME_PALETTE,
      });

      const result = await built.service.getMatchingVariations(testRun.id);

      const asked = built.compareGetChangeSignatureMock.mock.calls.map(([input]) => input.image.toString());
      expect(asked).toEqual([unsigned.imageName]);
      expect(result.variations.map((variation) => variation.id)).toEqual([testRun.id, unsigned.id]);
    });

    it('skips a far larger change without paying for its signature', async () => {
      const testRun = sibling('target', { customTags: '' });
      const bigger = sibling('locale-b', { diffPercent: 30 });

      const built = await initMatchingService({
        testRun,
        siblings: [bigger],
        signatureOf: () => SAME_PALETTE,
      });

      await built.service.getMatchingVariations(testRun.id);

      const asked = built.compareGetChangeSignatureMock.mock.calls.map(([input]) => input.image.toString());
      expect(asked).toEqual([testRun.imageName]);
    });

    it('says a sibling has no diff rather than blaming its change size', async () => {
      const testRun = sibling('target', { customTags: '' });
      const unchanged = sibling('locale-b', { diffPercent: 0 });

      const built = await initMatchingService({
        testRun,
        siblings: [unchanged],
        signatureOf: () => SAME_PALETTE,
      });

      const result = await built.service.getMatchingVariations(testRun.id);

      expect(result.skipped.map((item) => item.reason)).toEqual(['no diff to match']);
    });

    it('asks for the siblings signatures at once rather than one after another', async () => {
      const testRun = sibling('target', { customTags: '' });
      const siblings = ['locale-a', 'locale-b', 'locale-c'].map((id) => sibling(id));

      let inFlight = 0;
      let peakInFlight = 0;
      const built = await initMatchingService({
        testRun,
        siblings,
        signatureOf: async () => {
          inFlight += 1;
          peakInFlight = Math.max(peakInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 0));
          inFlight -= 1;
          return SAME_PALETTE;
        },
      });

      await built.service.getMatchingVariations(testRun.id);

      expect(peakInFlight).toBe(siblings.length + 1);
    });

    it('keeps the number of images being decoded at once bounded', async () => {
      const testRun = sibling('target', { customTags: '' });
      const siblings = Array.from({ length: SIGNATURE_CONCURRENCY * 3 }, (_, index) => sibling(`locale-${index}`));

      let inFlight = 0;
      let peakInFlight = 0;
      const built = await initMatchingService({
        testRun,
        siblings,
        signatureOf: async () => {
          inFlight += 1;
          peakInFlight = Math.max(peakInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 0));
          inFlight -= 1;
          return SAME_PALETTE;
        },
      });

      await built.service.getMatchingVariations(testRun.id);

      expect(peakInFlight).toBe(SIGNATURE_CONCURRENCY);
    });

    it('reuses the signatures it already computed when the dialog is reopened', async () => {
      const testRun = sibling('target', { customTags: '' });
      const matching = sibling('locale-a');

      const built = await initMatchingService({
        testRun,
        siblings: [matching],
        signatureOf: () => SAME_PALETTE,
      });

      await built.service.getMatchingVariations(testRun.id);
      const afterFirst = built.compareGetChangeSignatureMock.mock.calls.length;
      const second = await built.service.getMatchingVariations(testRun.id);

      expect(afterFirst).toBe(2);
      expect(built.compareGetChangeSignatureMock).toHaveBeenCalledTimes(2);
      expect(second.variations.map((variation) => variation.id)).toEqual([testRun.id, matching.id]);
    });

    it('recomputes a signature once the run gained an ignore area', async () => {
      const testRun = sibling('target', { customTags: '' });
      const matching = sibling('locale-a');

      const built = await initMatchingService({
        testRun,
        siblings: [matching],
        signatureOf: () => SAME_PALETTE,
      });

      await built.service.getMatchingVariations(testRun.id);
      matching.ignoreAreas = JSON.stringify([{ x: 0, y: 0, width: 10, height: 10 }]);
      await built.service.getMatchingVariations(testRun.id);

      expect(built.compareGetChangeSignatureMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('postTestRun branches', () => {
    const createTestRequestDto: CreateTestRequestDto = {
      buildId: 'buildId',
      projectId: 'projectId',
      name: 'Test name',
      branchName: 'develop',
    };

    const initPostService = async ({
      project = { ...TEST_PROJECT, autoApproveFeature: false },
      existingVariation = null as TestVariation | null,
      previousRuns = [] as TestRun[],
    }) => {
      const testRun = generateTestRun();
      const diffed = generateTestRun({ status: TestStatus.unresolved });
      const createdVariation = generateTestVariation({ id: 'created variation' });
      const testVariationServiceCreateMock = jest.fn().mockResolvedValueOnce(createdVariation);
      const testRunFindManyMock = jest.fn().mockResolvedValueOnce(previousRuns);
      const built = await initService({
        projectFindUniqueMock: jest.fn().mockResolvedValueOnce(project),
        testVariationFindMock: jest.fn().mockResolvedValueOnce(existingVariation),
        testVariationServiceCreateMock,
        testRunFindManyMock,
      });
      built.delete = jest.fn();
      built.create = jest.fn().mockResolvedValueOnce(testRun);
      built.calculateDiff = jest.fn().mockResolvedValueOnce(diffed);
      built['tryAutoApproveByPastBaselines'] = jest.fn();
      built['tryAutoApproveByNewBaselines'] = jest.fn();
      return { built, testRun, diffed, createdVariation, testVariationServiceCreateMock, testRunFindManyMock };
    };

    beforeEach(() => mocked(TestRunResultDto).mockClear());

    it('creates the test variation when there is none yet', async () => {
      const { built, testRun, diffed, createdVariation, testVariationServiceCreateMock } = await initPostService({});

      await built.postTestRun({ createTestRequestDto, imageBuffer });

      expect(testVariationServiceCreateMock).toHaveBeenCalledWith({ createTestRequestDto });
      expect(built.create).toHaveBeenCalledWith({ testVariation: createdVariation, createTestRequestDto, imageBuffer });
      expect(built.calculateDiff).toHaveBeenCalledWith(createTestRequestDto.projectId, testRun);
      expect(mocked(TestRunResultDto)).toHaveBeenCalledWith(diffed, createdVariation);
    });

    it('deletes nothing when there is no previous unapproved run', async () => {
      const { built } = await initPostService({ existingVariation: generateTestVariation() });

      await built.postTestRun({ createTestRequestDto, imageBuffer });

      expect(built.delete).not.toHaveBeenCalled();
    });

    it('only deletes the first previous unapproved run', async () => {
      const first = generateTestRun({ id: 'first' });
      const second = generateTestRun({ id: 'second' });
      const { built } = await initPostService({
        existingVariation: generateTestVariation(),
        previousRuns: [first, second],
      });

      await built.postTestRun({ createTestRequestDto, imageBuffer });

      expect(built.delete).toHaveBeenCalledTimes(1);
      expect(built.delete).toHaveBeenCalledWith('first');
    });

    it('skips auto approval when the project has it turned off', async () => {
      const variation = generateTestVariation();
      const { built, diffed } = await initPostService({ existingVariation: variation });

      await built.postTestRun({ createTestRequestDto, imageBuffer });

      expect(built['tryAutoApproveByPastBaselines']).not.toHaveBeenCalled();
      expect(built['tryAutoApproveByNewBaselines']).not.toHaveBeenCalled();
      expect(mocked(TestRunResultDto)).toHaveBeenCalledWith(diffed, variation);
    });

    it('chains the two auto approvals, each one seeing the result of the previous step', async () => {
      const variation = generateTestVariation();
      const { built, diffed } = await initPostService({
        project: { ...TEST_PROJECT, autoApproveFeature: true },
        existingVariation: variation,
      });
      const afterPast = generateTestRun({ id: 'after past' });
      const afterNew = generateTestRun({ id: 'after new' });
      built['tryAutoApproveByPastBaselines'] = jest.fn().mockResolvedValueOnce(afterPast);
      built['tryAutoApproveByNewBaselines'] = jest.fn().mockResolvedValueOnce(afterNew);

      await built.postTestRun({ createTestRequestDto, imageBuffer });

      expect(built['tryAutoApproveByPastBaselines']).toHaveBeenCalledWith({
        testVariation: variation,
        testRun: diffed,
      });
      expect(built['tryAutoApproveByNewBaselines']).toHaveBeenCalledWith({
        testVariation: variation,
        testRun: afterPast,
      });
      expect(mocked(TestRunResultDto)).toHaveBeenCalledWith(afterNew, variation);
    });

    it('fails only after the run is created and diffed when the project does not exist', async () => {
      const { built } = await initPostService({ project: null, existingVariation: generateTestVariation() });

      // NOTE: current behavior — a missing project is not checked up front; the run is created and
      // diffed, then reading project.autoApproveFeature throws a TypeError
      await expect(built.postTestRun({ createTestRequestDto, imageBuffer })).rejects.toThrow(TypeError);
      expect(built.create).toHaveBeenCalled();
      expect(built.calculateDiff).toHaveBeenCalled();
    });
  });

  describe('approve', () => {
    const copiedBaselineName = 'copied.baseline.png';

    const initApproveService = async (testRun: object | null) => {
      const testRunFindUniqueMock = jest.fn().mockResolvedValue(testRun);
      const testRunUpdateMock = jest.fn().mockResolvedValue(testRun);
      const copyImageMock = jest.fn().mockResolvedValue(copiedBaselineName);
      const testVariationServiceFindUniqueMock = jest.fn();
      const testVariationServiceCreateMock = jest.fn();
      const testVariationUpdateMock = jest.fn();
      const testVariationAddBaselineMock = jest.fn();
      const eventTestRunUpdatedMock = jest.fn();
      const built = await initService({
        testRunFindUniqueMock,
        testRunUpdateMock,
        copyImageMock,
        testVariationServiceFindUniqueMock,
        testVariationServiceCreateMock,
        testVariationUpdateMock,
        testVariationAddBaselineMock,
        eventTestRunUpdatedMock,
      });
      return {
        built,
        testRunFindUniqueMock,
        testRunUpdateMock,
        copyImageMock,
        testVariationServiceFindUniqueMock,
        testVariationServiceCreateMock,
        testVariationUpdateMock,
        testVariationAddBaselineMock,
        eventTestRunUpdatedMock,
      };
    };

    const mainVariation = generateTestVariation({ id: 'main variation', branchName: 'master' });

    it('throws when the run has no test variation', async () => {
      const { built, copyImageMock } = await initApproveService({ ...generateTestRun(), testVariation: null });

      await expect(built.approve('id')).rejects.toThrow('No test variation found. Re-create test run');
      expect(copyImageMock).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the run does not exist', async () => {
      const { built } = await initApproveService(null);

      await expect(built.approve('id')).rejects.toThrow(new NotFoundException('Test run not found: id'));
    });

    it('copies the image as the new baseline of the same-branch variation and marks the run approved', async () => {
      const testRun = {
        ...generateTestRun({ branchName: 'master', baselineBranchName: 'master', imageName: 'image.png' }),
        testVariation: mainVariation,
      };
      const mocks = await initApproveService(testRun);

      const result = await mocks.built.approve(testRun.id, false, false, 'user id');

      expect(mocks.copyImageMock).toHaveBeenCalledWith('baseline', 'image.png');
      expect(mocks.testVariationServiceFindUniqueMock).not.toHaveBeenCalled();
      expect(mocks.testVariationAddBaselineMock).toHaveBeenCalledWith({
        id: mainVariation.id,
        userId: 'user id',
        testRunId: testRun.id,
        baselineName: copiedBaselineName,
      });
      expect(mocks.testRunUpdateMock).toHaveBeenCalledWith({
        where: { id: testRun.id },
        data: { status: TestStatus.approved },
      });
      expect(mocks.eventTestRunUpdatedMock).toHaveBeenCalledWith(testRun);
      expect(result).toBe(testRun);
    });

    it('creates a feature-branch variation when approving a feature-branch run against the main baseline', async () => {
      const testRun = {
        ...generateTestRun({
          branchName: 'feature',
          baselineBranchName: 'master',
          baselineName: 'old.baseline.png',
          ignoreAreas: '[{"x":1}]',
          comment: 'run comment',
        }),
        testVariation: mainVariation,
      };
      const mocks = await initApproveService(testRun);
      const created = generateTestVariation({ id: 'created feature variation', branchName: 'feature' });
      const updated = generateTestVariation({ id: 'updated feature variation', branchName: 'feature' });
      mocks.testVariationServiceFindUniqueMock.mockResolvedValueOnce(null);
      mocks.testVariationServiceCreateMock.mockResolvedValueOnce(created);
      mocks.testVariationUpdateMock.mockResolvedValueOnce(updated);

      await mocks.built.approve(testRun.id, false, false, 'user id');

      // NOTE: current behavior — the whole run (including the nested testVariation) is spread into findUnique
      expect(mocks.testVariationServiceFindUniqueMock).toHaveBeenCalledWith({ ...testRun });
      expect(mocks.testVariationServiceCreateMock).toHaveBeenCalledWith({
        testRunId: testRun.id,
        createTestRequestDto: {
          projectId: testRun.projectId,
          branchName: 'feature',
          ...getTestVariationUniqueData(testRun),
        },
      });
      // NOTE: current behavior — carries over the run's *previous* baselineName, the new copy only
      // reaches the variation through addBaseline below
      expect(mocks.testVariationUpdateMock).toHaveBeenCalledWith(
        created.id,
        { baselineName: 'old.baseline.png', ignoreAreas: '[{"x":1}]', comment: 'run comment' },
        testRun.id
      );
      expect(mocks.testVariationAddBaselineMock).toHaveBeenCalledWith({
        id: updated.id,
        userId: 'user id',
        testRunId: testRun.id,
        baselineName: copiedBaselineName,
      });
      expect(mocks.testRunUpdateMock).toHaveBeenCalledWith({
        where: { id: testRun.id },
        data: { status: TestStatus.approved },
      });
    });

    it('reuses the existing feature-branch variation', async () => {
      const testRun = {
        ...generateTestRun({ branchName: 'feature', baselineBranchName: 'master' }),
        testVariation: mainVariation,
      };
      const mocks = await initApproveService(testRun);
      const existing = generateTestVariation({ id: 'existing feature variation', branchName: 'feature' });
      mocks.testVariationServiceFindUniqueMock.mockResolvedValueOnce(existing);
      mocks.testVariationUpdateMock.mockResolvedValueOnce(existing);

      await mocks.built.approve(testRun.id);

      expect(mocks.testVariationServiceCreateMock).not.toHaveBeenCalled();
      expect(mocks.testVariationUpdateMock).toHaveBeenCalledWith(existing.id, expect.any(Object), testRun.id);
      expect(mocks.testVariationAddBaselineMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: existing.id, userId: undefined })
      );
    });

    it('adds the baseline straight to the main variation when merging', async () => {
      const testRun = {
        ...generateTestRun({ branchName: 'feature', baselineBranchName: 'master' }),
        testVariation: mainVariation,
      };
      const mocks = await initApproveService(testRun);

      await mocks.built.approve(testRun.id, true);

      expect(mocks.testVariationServiceFindUniqueMock).not.toHaveBeenCalled();
      expect(mocks.testVariationUpdateMock).not.toHaveBeenCalled();
      expect(mocks.testVariationAddBaselineMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: mainVariation.id, baselineName: copiedBaselineName })
      );
      expect(mocks.testRunUpdateMock).toHaveBeenCalledWith({
        where: { id: testRun.id },
        data: { status: TestStatus.approved },
      });
    });

    it('auto approves a feature-branch run without touching any variation', async () => {
      const testRun = {
        ...generateTestRun({ branchName: 'feature', baselineBranchName: 'master' }),
        testVariation: mainVariation,
      };
      const mocks = await initApproveService(testRun);

      await mocks.built.approve(testRun.id, false, true);

      // NOTE: current behavior — the baseline image is still copied even though nothing references it
      expect(mocks.copyImageMock).toHaveBeenCalledWith('baseline', testRun.imageName);
      expect(mocks.testVariationServiceFindUniqueMock).not.toHaveBeenCalled();
      expect(mocks.testVariationAddBaselineMock).not.toHaveBeenCalled();
      expect(mocks.testRunUpdateMock).toHaveBeenCalledWith({
        where: { id: testRun.id },
        data: { status: TestStatus.autoApproved },
      });
    });

    it('auto approves a same-branch run by adding the baseline', async () => {
      const testRun = {
        ...generateTestRun({ branchName: 'master', baselineBranchName: 'master' }),
        testVariation: mainVariation,
      };
      const mocks = await initApproveService(testRun);

      await mocks.built.approve(testRun.id, false, true);

      expect(mocks.testVariationAddBaselineMock).toHaveBeenCalledWith({
        id: mainVariation.id,
        userId: undefined,
        testRunId: testRun.id,
        baselineName: copiedBaselineName,
      });
      expect(mocks.testRunUpdateMock).toHaveBeenCalledWith({
        where: { id: testRun.id },
        data: { status: TestStatus.autoApproved },
      });
    });
  });

  describe('create details', () => {
    it('prefers the comment of the request over the one of the variation', async () => {
      const testRunCreateMock = jest.fn().mockResolvedValueOnce(generateTestRun());
      const eventTestRunCreatedMock = jest.fn();
      service = await initService({
        testRunCreateMock,
        eventTestRunCreatedMock,
        saveImageMock: jest.fn().mockResolvedValueOnce('image.png'),
      });

      const result = await service.create({
        testVariation: generateTestVariation({ comment: 'variation comment' }),
        createTestRequestDto: {
          buildId: 'buildId',
          projectId: 'projectId',
          name: 'Test name',
          branchName: 'develop',
          comment: 'request comment',
        },
        imageBuffer,
      });

      const { data } = testRunCreateMock.mock.calls[0][0];
      expect(data.comment).toBe('request comment');
      expect(data.imageName).toBe('image.png');
      // NOTE: current behavior — absent ignore areas are stored as undefined (JSON.stringify(undefined))
      expect(data.tempIgnoreAreas).toBeUndefined();
      expect(eventTestRunCreatedMock).toHaveBeenCalledWith(result);
    });
  });

  describe('calculateDiff details', () => {
    it('compares with the permanent and temporary ignore areas together and returns the saved run', async () => {
      const permanent = { x: 1, y: 1, width: 1, height: 1 };
      const temporary = { x: 2, y: 2, width: 2, height: 2 };
      const testRun = generateTestRun({
        ignoreAreas: JSON.stringify([permanent]),
        tempIgnoreAreas: JSON.stringify([temporary]),
      });
      const saved = generateTestRun({ id: 'saved' });
      const compareGetDiffMock = jest.fn().mockResolvedValueOnce({ status: TestStatus.ok });
      const deleteImageMock = jest.fn();
      service = await initService({
        compareGetDiffMock,
        deleteImageMock,
        testRunUpdateMock: jest.fn().mockResolvedValueOnce(saved),
      });

      const result = await service.calculateDiff('projectId', testRun);

      expect(compareGetDiffMock.mock.calls[0][0].data.ignoreAreas).toEqual([permanent, temporary]);
      expect(result).toBe(saved);
      // NOTE: current behavior — deleteImage is also asked to delete the missing (null) thumbnails
      expect(deleteImageMock.mock.calls).toEqual([[testRun.diffName], [null], [null]]);
    });

    it('treats null ignore areas as none', async () => {
      const testRun = generateTestRun({ ignoreAreas: 'null', tempIgnoreAreas: 'null' });
      const compareGetDiffMock = jest.fn().mockResolvedValueOnce(null);
      const testRunUpdateMock = jest.fn().mockResolvedValueOnce(testRun);
      service = await initService({ compareGetDiffMock, testRunUpdateMock });

      await service.calculateDiff('projectId', testRun);

      expect(compareGetDiffMock.mock.calls[0][0].data.ignoreAreas).toEqual([]);
      expect(testRunUpdateMock.mock.calls[0][0].data.status).toBe(TestStatus.new);
    });
  });

  describe('saveDiffResult details', () => {
    it('stores an absent analysis as undefined rather than null', async () => {
      const testRunUpdateMock = jest.fn().mockResolvedValueOnce(generateTestRun());
      service = await initService({ testRunUpdateMock });

      await service.saveDiffResult('id', {
        status: TestStatus.ok,
        diffName: null,
        pixelMisMatchCount: 0,
        diffPercent: 0,
        isSameDimension: true,
      });

      expect(testRunUpdateMock.mock.calls[0][0].data).toEqual({
        diffName: null,
        pixelMisMatchCount: 0,
        diffPercent: 0,
        status: TestStatus.ok,
        vlmDescription: undefined,
        changeSignature: null,
        imageThumbnailName: null,
        diffThumbnailName: null,
      });
    });
  });

  describe('delete failures', () => {
    const initDeleteService = async (deleteError: unknown) => {
      const testRun = generateTestRun();
      const eventTestRunDeletedMock = jest.fn();
      const built = await initService({
        testRunFindUniqueMock: jest.fn().mockResolvedValueOnce(testRun),
        testRunDeleteMock: jest.fn().mockRejectedValueOnce(deleteError),
        eventTestRunDeletedMock,
      });
      return { built, testRun, eventTestRunDeletedMock };
    };

    it('treats a run that is already gone as deleted, without announcing it', async () => {
      const { built, testRun, eventTestRunDeletedMock } = await initDeleteService(
        new Prisma.PrismaClientKnownRequestError('gone', { code: 'P2025', clientVersion: 'test' })
      );

      const result = await built.delete(testRun.id);

      expect(result).toBeUndefined();
      expect(eventTestRunDeletedMock).not.toHaveBeenCalled();
    });

    it.each([
      [
        'another prisma error',
        new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'test' }),
      ],
      ['any other error', new Error('connection lost')],
    ])('swallows %s and reports the run as deleted', async (_case, error) => {
      const { built, testRun, eventTestRunDeletedMock } = await initDeleteService(error);

      const result = await built.delete(testRun.id);

      // NOTE: current behavior — every delete failure other than P2025 is silently ignored and the run is
      // announced as deleted although it may still exist
      expect(result).toBe(testRun);
      expect(eventTestRunDeletedMock).toHaveBeenCalledWith(testRun);
    });
  });

  describe('addIgnoreAreas', () => {
    const newArea = { x: 5, y: 6, width: 7, height: 8 };

    it.each([
      ['appends to the existing areas', JSON.stringify(ignoreAreas), [...ignoreAreas, newArea]],
      ['starts from none when they are null', 'null', [newArea]],
    ])('%s', async (_case, stored, expected) => {
      const testRunFindUniqueMock = jest.fn().mockResolvedValueOnce(generateTestRun({ ignoreAreas: stored }));
      service = await initService({ testRunFindUniqueMock });
      const updated = generateTestRun({ id: 'updated' });
      service.updateIgnoreAreas = jest.fn().mockResolvedValueOnce(updated);

      const result = await service.addIgnoreAreas('id', [newArea]);

      expect(testRunFindUniqueMock).toHaveBeenCalledWith({ where: { id: 'id' }, include: { testVariation: true } });
      expect(service.updateIgnoreAreas).toHaveBeenCalledWith('id', expected);
      expect(result).toBe(updated);
    });
  });

  describe('updateIgnoreAreas details', () => {
    it('returns the recalculated run', async () => {
      const testRun = generateTestRun();
      const recalculated = generateTestRun({ id: 'recalculated' });
      service = await initService({
        testRunUpdateMock: jest.fn().mockResolvedValueOnce(testRun),
        testVariationUpdateMock: jest.fn().mockResolvedValueOnce(generateTestVariation({ projectId: 'p' })),
      });
      service.calculateDiff = jest.fn().mockResolvedValueOnce(recalculated);

      expect(await service.updateIgnoreAreas(testRun.id, ignoreAreas)).toBe(recalculated);
    });
  });

  describe('update details', () => {
    it('returns the updated run', async () => {
      const testRun = generateTestRun();
      service = await initService({ testRunUpdateMock: jest.fn().mockResolvedValueOnce(testRun) });

      expect(await service.update(testRun.id, { comment: 'c' })).toBe(testRun);
    });
  });

  describe('shouldAutoApprove', () => {
    const testRun = generateTestRun({
      imageName: 'image.png',
      ignoreAreas: JSON.stringify(ignoreAreas),
      diffTollerancePercent: 3,
    });
    const baseline = generateBaseline({ baselineName: 'past.baseline.png' });

    it('compares the run against the given baseline without saving a diff, and approves an ok result', async () => {
      const compareGetDiffMock = jest.fn().mockResolvedValueOnce({ status: TestStatus.ok });
      service = await initService({ compareGetDiffMock });

      const result = await service['shouldAutoApprove']({ projectId: 'projectId', baseline, testRun });

      expect(compareGetDiffMock).toHaveBeenCalledWith({
        projectId: 'projectId',
        data: {
          image: 'image.png',
          baseline: 'past.baseline.png',
          ignoreAreas,
          diffTollerancePercent: 3,
          saveDiffAsFile: false,
        },
      });
      expect(result).toBe(true);
    });

    it('does not approve any other result', async () => {
      service = await initService({
        compareGetDiffMock: jest.fn().mockResolvedValueOnce({ status: TestStatus.unresolved }),
      });

      const result = await service['shouldAutoApprove']({ projectId: 'projectId', baseline, testRun });

      // NOTE: current behavior — resolves to undefined, not false
      expect(result).toBeUndefined();
    });
  });

  describe('auto approval details', () => {
    it('by past baselines skips the latest baseline and approves on the first older one that matches', async () => {
      const testRun = generateTestRun({ status: TestStatus.unresolved, branchName: 'feature' });
      const latest = generateBaseline({ id: 'latest' });
      const older = generateBaseline({ id: 'older' });
      const oldest = generateBaseline({ id: 'oldest' });
      const testVariation = generateTestVariation({ id: 'variation', projectId: 'project' });
      const testVariationGetDetailsMock = jest
        .fn()
        .mockResolvedValueOnce(generateTestVariation({}, [latest, older, oldest]));
      service = await initService({ testVariationGetDetailsMock });
      service['shouldAutoApprove'] = jest.fn().mockResolvedValueOnce(true);
      const approved = generateTestRun({ status: TestStatus.autoApproved });
      service.approve = jest.fn().mockResolvedValueOnce(approved);

      const result = await service['tryAutoApproveByPastBaselines']({ testVariation, testRun });

      expect(testVariationGetDetailsMock).toHaveBeenCalledWith('variation');
      expect(service['shouldAutoApprove']).toHaveBeenCalledTimes(1);
      expect(service['shouldAutoApprove']).toHaveBeenCalledWith({ projectId: 'project', baseline: older, testRun });
      expect(service.approve).toHaveBeenCalledWith(testRun.id, false, true);
      expect(result).toBe(approved);
    });

    it('by past baselines has nothing to try with a single baseline', async () => {
      const testRun = generateTestRun({ status: TestStatus.unresolved, branchName: 'feature' });
      service = await initService({
        testVariationGetDetailsMock: jest.fn().mockResolvedValueOnce(generateTestVariation({}, [generateBaseline()])),
      });
      service['shouldAutoApprove'] = jest.fn();

      const result = await service['tryAutoApproveByPastBaselines']({
        testVariation: generateTestVariation(),
        testRun,
      });

      expect(service['shouldAutoApprove']).not.toHaveBeenCalled();
      expect(result).toBe(testRun);
    });

    it('by new baselines looks for approved runs against the same baseline and compares with their latest baseline', async () => {
      const testRun = generateTestRun({ status: TestStatus.unresolved });
      const testVariation = generateTestVariation({ id: 'variation', projectId: 'project', baselineName: 'b.png' });
      const approvedRun = generateTestRun({ status: TestStatus.approved, testVariationId: 'other variation' });
      const latest = generateBaseline({ id: 'latest' });
      const testRunFindManyMock = jest.fn().mockResolvedValueOnce([approvedRun]);
      const testVariationGetDetailsMock = jest
        .fn()
        .mockResolvedValueOnce(generateTestVariation({}, [latest, generateBaseline({ id: 'older' })]));
      service = await initService({ testRunFindManyMock, testVariationGetDetailsMock });
      service['shouldAutoApprove'] = jest.fn().mockResolvedValueOnce(true);
      service.approve = jest.fn().mockResolvedValueOnce(testRun);

      await service['tryAutoApproveByNewBaselines']({ testVariation, testRun });

      expect(testRunFindManyMock).toHaveBeenCalledWith({
        where: {
          ...getTestVariationUniqueData(testVariation),
          baselineName: 'b.png',
          status: TestStatus.approved,
          testVariation: { projectId: 'project' },
        },
      });
      expect(testVariationGetDetailsMock).toHaveBeenCalledWith('other variation');
      expect(service['shouldAutoApprove']).toHaveBeenCalledWith({ projectId: 'project', baseline: latest, testRun });
      expect(service.approve).toHaveBeenCalledWith(testRun.id, false, true);
    });

    it('by new baselines keeps the run when nothing was approved before', async () => {
      const testRun = generateTestRun({ status: TestStatus.unresolved });
      service = await initService({ testRunFindManyMock: jest.fn().mockResolvedValueOnce([]) });
      service['shouldAutoApprove'] = jest.fn();

      const result = await service['tryAutoApproveByNewBaselines']({
        testVariation: generateTestVariation(),
        testRun,
      });

      expect(service['shouldAutoApprove']).not.toHaveBeenCalled();
      expect(result).toBe(testRun);
    });
  });

  describe('getMatchingVariations edge cases', () => {
    const histogram = (hot: number): number[] =>
      Array.from({ length: SIGNATURE_LENGTH }, (_unused, index) => (index === hot ? 1 : 0));
    const SAME_PALETTE = histogram(0);

    const sibling = (id: string, overrides: Partial<TestRun> = {}): TestRun =>
      generateTestRun({
        id,
        status: TestStatus.unresolved,
        name: 'Screen A',
        baselineName: `${id}.baseline.png`,
        imageName: `${id}.screenshot.png`,
        customTags: id,
        diffPercent: 12,
        ...overrides,
      });

    const initEdgeService = async ({
      testRun,
      siblings = [],
      project = { bulkApproveVariations: true, bulkApproveGroupBy: 'customTags', imageComparisonConfig: null } as
        object | null,
      signatureOf = (() => SAME_PALETTE) as (imageName: string) => Promise<number[] | null> | number[] | null,
      getImageBufferMock = jest.fn().mockImplementation(async (name: string) => Buffer.from(name)),
    }: {
      testRun: TestRun | null;
      siblings?: TestRun[];
      project?: object | null;
      signatureOf?: (imageName: string) => Promise<number[] | null> | number[] | null;
      getImageBufferMock?: jest.Mock;
    }) => {
      const compareGetChangeSignatureMock = jest.fn().mockImplementation(async (input) => ({
        signature: await signatureOf(input.image.toString()),
      }));
      const projectFindUniqueMock = jest.fn().mockResolvedValue(project);
      const testRunFindManyMock = jest.fn().mockResolvedValue(siblings);
      const built = await initService({
        testRunFindUniqueMock: jest.fn().mockResolvedValue(testRun),
        testRunFindManyMock,
        projectFindUniqueMock,
        getImageBufferMock,
        compareGetChangeSignatureMock,
      });
      return { built, compareGetChangeSignatureMock, projectFindUniqueMock, testRunFindManyMock };
    };

    it('throws for an unknown test run', async () => {
      const { built } = await initEdgeService({ testRun: null });

      await expect(built.getMatchingVariations('missing')).rejects.toThrow(
        new NotFoundException('Test run not found: missing')
      );
    });

    it('returns only the run itself when the run has no project', async () => {
      const testRun = sibling('target', { projectId: null });
      const { built, projectFindUniqueMock, testRunFindManyMock } = await initEdgeService({ testRun });

      const result = await built.getMatchingVariations(testRun.id);

      expect(projectFindUniqueMock).not.toHaveBeenCalled();
      expect(testRunFindManyMock).not.toHaveBeenCalled();
      expect(result).toEqual({ variations: [new TestRunDto(testRun)], skipped: [] });
    });

    it('returns only the run itself when the project has bulk approval turned off', async () => {
      const testRun = sibling('target');
      const { built, projectFindUniqueMock, testRunFindManyMock } = await initEdgeService({
        testRun,
        project: { bulkApproveVariations: false },
      });

      const result = await built.getMatchingVariations(testRun.id);

      expect(projectFindUniqueMock).toHaveBeenCalledWith({ where: { id: testRun.projectId } });
      expect(testRunFindManyMock).not.toHaveBeenCalled();
      expect(result).toEqual({ variations: [new TestRunDto(testRun)], skipped: [] });
    });

    it('looks for unresolved and new siblings that differ only in customTags by default', async () => {
      const testRun = sibling('target', { os: 'linux', device: null, browser: 'chrome', viewport: '800x600' });
      const { built, testRunFindManyMock } = await initEdgeService({ testRun });

      await built.getMatchingVariations(testRun.id);

      expect(testRunFindManyMock).toHaveBeenCalledWith({
        where: {
          id: { not: testRun.id },
          buildId: testRun.buildId,
          branchName: testRun.branchName,
          name: testRun.name,
          os: 'linux',
          device: null,
          browser: 'chrome',
          viewport: '800x600',
          status: { in: [TestStatus.unresolved, TestStatus.new] },
        },
      });
    });

    it.each([
      ['os', { customTags: 'target', device: null, browser: 'chromium', viewport: '1800x1600' }],
      ['viewport', { customTags: 'target', os: null, device: null, browser: 'chromium' }],
      ['an unknown axis', { os: null, device: null, browser: 'chromium', viewport: '1800x1600' }],
    ])('groups across %s when the project says so', async (groupBy, fixedAxes) => {
      const testRun = sibling('target');
      const { built, testRunFindManyMock } = await initEdgeService({
        testRun,
        project: {
          bulkApproveVariations: true,
          bulkApproveGroupBy: groupBy === 'an unknown axis' ? 'locale' : groupBy,
        },
      });

      await built.getMatchingVariations(testRun.id);

      const { where } = testRunFindManyMock.mock.calls[0][0];
      const axes = ['customTags', 'os', 'device', 'browser', 'viewport'].filter((axis) => axis in where);
      expect(Object.fromEntries(axes.map((axis) => [axis, where[axis]]))).toEqual(fixedAxes);
    });

    it('signs with the threshold and anti-aliasing setting of the project config', async () => {
      const testRun = sibling('target', { ignoreAreas: JSON.stringify(ignoreAreas) });
      const { built, compareGetChangeSignatureMock } = await initEdgeService({
        testRun,
        project: {
          bulkApproveVariations: true,
          imageComparisonConfig: '{ "threshold": 0.3, "ignoreAntialiasing": false }',
        },
      });

      await built.getMatchingVariations(testRun.id);

      expect(compareGetChangeSignatureMock).toHaveBeenCalledWith({
        baseline: Buffer.from(testRun.baselineName),
        image: Buffer.from(testRun.imageName),
        ignoreAreas,
        threshold: 0.3,
        includeAA: false,
      });
    });

    it('sends every sibling to manual review when the reviewed run has no baseline to compare', async () => {
      const testRun = sibling('target', { baselineName: null });
      const unchanged = sibling('locale-a', { diffPercent: 0 });
      const candidate = sibling('locale-b');
      const { built, compareGetChangeSignatureMock } = await initEdgeService({
        testRun,
        siblings: [unchanged, candidate],
      });

      const result = await built.getMatchingVariations(testRun.id);

      expect(result.variations.map((variation) => variation.id)).toEqual([testRun.id]);
      expect(result.skipped.map((item) => [item.id, item.reason])).toEqual([
        [unchanged.id, 'no reference diff'],
        [candidate.id, 'no reference diff'],
      ]);
      // NOTE: current behavior — the candidate is still signed although there is nothing to match it against
      expect(compareGetChangeSignatureMock.mock.calls.map(([input]) => input.image.toString())).toEqual([
        candidate.imageName,
      ]);
    });

    it('treats a missing screenshot as no reference diff', async () => {
      const testRun = sibling('target');
      const { built, compareGetChangeSignatureMock } = await initEdgeService({
        testRun,
        siblings: [sibling('locale-a')],
        getImageBufferMock: jest.fn().mockResolvedValue(null),
      });

      const result = await built.getMatchingVariations(testRun.id);

      expect(compareGetChangeSignatureMock).not.toHaveBeenCalled();
      expect(result.skipped.map((item) => item.reason)).toEqual(['no reference diff']);
    });

    it('skips a sibling that has nothing to compare with no diff to match', async () => {
      const testRun = sibling('target');
      const noBaseline = sibling('locale-a', { baselineName: null });
      const noSignature = sibling('locale-b');
      const matching = sibling('locale-c');
      const { built } = await initEdgeService({
        testRun,
        siblings: [noBaseline, noSignature, matching],
        signatureOf: (imageName) => (imageName.startsWith('locale-b') ? null : SAME_PALETTE),
      });

      const result = await built.getMatchingVariations(testRun.id);

      expect(result.variations.map((variation) => variation.id)).toEqual([testRun.id, matching.id]);
      expect(result.skipped.map((item) => [item.id, item.reason])).toEqual([
        [noBaseline.id, 'no diff to match'],
        [noSignature.id, 'no diff to match'],
      ]);
    });

    it('lists skipped siblings in the order they were found, whichever check skipped them', async () => {
      const testRun = sibling('target');
      const otherPattern = sibling('locale-a');
      const unchanged = sibling('locale-b', { diffPercent: 0 });
      const bigger = sibling('locale-c', { diffPercent: 100 });
      const { built } = await initEdgeService({
        testRun,
        siblings: [otherPattern, unchanged, bigger],
        signatureOf: (imageName) => (imageName.startsWith('locale-a') ? histogram(SIGNATURE_LENGTH - 1) : SAME_PALETTE),
      });

      const result = await built.getMatchingVariations(testRun.id);

      expect(result.skipped.map((item) => [item.id, item.reason])).toEqual([
        [otherPattern.id, 'different change pattern'],
        [unchanged.id, 'no diff to match'],
        [bigger.id, 'different change size'],
      ]);
      expect(result.skipped[0]).toEqual({ ...new TestRunDto(otherPattern), reason: 'different change pattern' });
    });

    it.each([
      [12, 24, 'matches'],
      [12, 6, 'matches'],
      [12, 24.5, 'different change size'],
      [12, 5.9, 'different change size'],
      [0, 12, 'different change size'],
      [null, 12, 'different change size'],
    ])('with the reviewed change at %p%% a sibling at %p%% %s', async (reference, size, outcome) => {
      const testRun = sibling('target', { diffPercent: reference });
      const other = sibling('locale-a', { diffPercent: size });
      const { built } = await initEdgeService({ testRun, siblings: [other] });

      const result = await built.getMatchingVariations(testRun.id);

      if (outcome === 'matches') {
        expect(result.variations.map((variation) => variation.id)).toEqual([testRun.id, other.id]);
      } else {
        expect(result.skipped.map((item) => item.reason)).toEqual([outcome]);
      }
    });

    it('recomputes and warns when the stored signature cannot be read', async () => {
      const testRun = sibling('target', { changeSignature: '{not json' });
      const { built, compareGetChangeSignatureMock } = await initEdgeService({ testRun });
      const warn = jest.spyOn(built['logger'], 'warn').mockImplementation(() => undefined);

      await built.getMatchingVariations(testRun.id);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Ignoring unreadable stored change signature'));
      expect(compareGetChangeSignatureMock).toHaveBeenCalledTimes(1);
    });

    it('recomputes a stored signature that has no histogram at all', async () => {
      const testRun = sibling('target', { changeSignature: 'null' });
      const { built, compareGetChangeSignatureMock } = await initEdgeService({ testRun });

      await built.getMatchingVariations(testRun.id);

      expect(compareGetChangeSignatureMock).toHaveBeenCalledTimes(1);
    });

    it('does not remember a failed signature', async () => {
      const testRun = sibling('target');
      let calls = 0;
      const { built, compareGetChangeSignatureMock } = await initEdgeService({
        testRun,
        signatureOf: () => {
          calls += 1;
          if (calls === 1) {
            throw new Error('worker crashed');
          }
          return SAME_PALETTE;
        },
      });

      await expect(built.getMatchingVariations(testRun.id)).rejects.toThrow('worker crashed');
      const result = await built.getMatchingVariations(testRun.id);

      expect(compareGetChangeSignatureMock).toHaveBeenCalledTimes(2);
      expect(result.variations.map((variation) => variation.id)).toEqual([testRun.id]);
    });
  });

  describe('signature cache', () => {
    beforeEach(async () => {
      service = await initService({});
    });

    it('forgets the oldest entry once it holds more than 2000', () => {
      const cache = service['signatureCache'];
      for (let index = 0; index <= 2000; index++) {
        cache.set(`key ${index}`, Promise.resolve([index]));
      }

      expect(cache.get('key 0')).toBeUndefined();
      expect(cache.get('key 1')).toBeDefined();
      expect(cache.get('key 2000')).toBeDefined();
    });

    it('keeps an entry that was read recently', () => {
      const cache = service['signatureCache'];
      for (let index = 0; index < 2000; index++) {
        cache.set(`key ${index}`, Promise.resolve([index]));
      }

      cache.get('key 0');
      cache.set('one more', Promise.resolve([]));

      expect(cache.get('key 0')).toBeDefined();
      expect(cache.get('key 1')).toBeUndefined();
    });

    it('moves a re-set entry to the back', () => {
      const cache = service['signatureCache'];
      for (let index = 0; index < 2000; index++) {
        cache.set(`key ${index}`, Promise.resolve([index]));
      }

      const replacement = Promise.resolve([42]);
      cache.set('key 0', replacement);
      cache.set('one more', Promise.resolve([]));

      expect(cache.get('key 0')).toBe(replacement);
      expect(cache.get('key 1')).toBeUndefined();
    });
  });
});
