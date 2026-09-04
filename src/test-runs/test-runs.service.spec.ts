import { mocked } from 'jest-mock';
import { Test, TestingModule } from '@nestjs/testing';
import { SIGNATURE_CONCURRENCY, TestRunsService } from './test-runs.service';
import { PrismaService } from '../prisma/prisma.service';
import { StaticService } from '../static/static.service';
import { TestStatus, TestRun, TestVariation } from '@prisma/client';
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
        changeSignature: [0.25, 0.75],
      });

      expect(testRunUpdateMock.mock.calls[0][0].data).toMatchObject({
        changeSignature: JSON.stringify([0.25, 0.75]),
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

  describe('getMatchingVariations', () => {
    const SAME_PALETTE = [1, 0];
    const OTHER_PALETTE = [0, 1];

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
        sibling(id, { changeSignature: JSON.stringify(signature), ...overrides });
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

    // builds ingested before the column existed, and runs compared by something
    // other than pixelmatch, still have to group
    it('falls back to computing for a run with nothing stored', async () => {
      const testRun = sibling('target', { customTags: '', changeSignature: JSON.stringify(SAME_PALETTE) });
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
});
