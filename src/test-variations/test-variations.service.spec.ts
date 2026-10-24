import { Test, TestingModule } from '@nestjs/testing';
import { TestVariationsService } from './test-variations.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTestRequestDto } from '../test-runs/dto/create-test-request.dto';
import { StaticService } from '../static/static.service';
import { TestVariation, Baseline, Project, Build } from '@prisma/client';
import { PNG } from 'pngjs';
import { BuildsService } from '../builds/builds.service';
import { TestRunsService } from '../test-runs/test-runs.service';
import { generateTestVariation, TEST_PROJECT } from '../_data_';
import { TestVariationUpdateDto } from './dto/test-variation-update.dto';

const initModule = async ({
  imageDeleteMock = jest.fn(),
  getImageBufferMock = jest.fn(),
  variationfindUniqueMock = jest.fn,
  variationFindManyMock = jest.fn().mockReturnValue([]),
  variationCreateMock = jest.fn(),
  variationUpdateMock = jest.fn(),
  variationDeleteMock = jest.fn(),
  baselineDeleteMock = jest.fn(),
  projectFindUniqueMock = jest.fn(),
  buildFindOrCreateMock = jest.fn(),
  buildUpdateMock = jest.fn(),
  testRunCreateMock = jest.fn(),
  testRunFindMany = jest.fn(),
  testRunDeleteMock = jest.fn(),
  testRuncalCulateDiffMock = jest.fn(),
  $executeRawMock = jest.fn(),
}) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TestVariationsService,
      {
        provide: StaticService,
        useValue: {
          getImageBuffer: getImageBufferMock,
          deleteImage: imageDeleteMock,
        },
      },
      {
        provide: BuildsService,
        useValue: {
          findOrCreate: buildFindOrCreateMock,
          update: buildUpdateMock,
        },
      },
      {
        provide: TestRunsService,
        useValue: {
          delete: testRunDeleteMock,
          create: testRunCreateMock,
          calculateDiff: testRuncalCulateDiffMock,
        },
      },
      {
        provide: PrismaService,
        useValue: {
          $executeRaw: $executeRawMock,
          testVariation: {
            findUnique: variationfindUniqueMock,
            findMany: variationFindManyMock,
            create: variationCreateMock,
            update: variationUpdateMock,
            delete: variationDeleteMock,
          },
          baseline: {
            delete: baselineDeleteMock,
          },
          project: {
            findUnique: projectFindUniqueMock,
          },
          testRun: {
            findMany: testRunFindMany,
          },
        },
      },
    ],
  }).compile();

  return module.get<TestVariationsService>(TestVariationsService);
};

describe('TestVariationsService', () => {
  let service: TestVariationsService;
  const projectMock = TEST_PROJECT;

  describe('getDetails', () => {
    it('can find one', async () => {
      const id = 'test id';
      const variationfindUniqueMock = jest.fn();
      service = await initModule({ variationfindUniqueMock });

      await service.getDetails(id);

      expect(variationfindUniqueMock).toHaveBeenCalledWith({
        where: { id },
        include: {
          baselines: {
            include: {
              testRun: true,
              user: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
      });
    });
  });

  describe('find', () => {
    it('can find by main branch', async () => {
      const createRequest: CreateTestRequestDto = {
        buildId: 'buildId',
        projectId: projectMock.id,
        name: 'Test name',
        os: 'OS',
        browser: 'browser',
        viewport: 'viewport',
        device: 'device',
        customTags: '',
        branchName: 'develop',
      };

      const variationMock: TestVariation = {
        id: '123',
        projectId: projectMock.id,
        name: 'Test name',
        baselineName: 'baselineName',
        os: 'OS',
        browser: 'browser',
        viewport: 'viewport',
        device: 'device',
        customTags: '',
        ignoreAreas: '[]',
        comment: 'some comment',
        branchName: 'develop',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const projectFindUniqueMock = jest.fn().mockReturnValueOnce(projectMock);
      service = await initModule({ projectFindUniqueMock });
      service.findUnique = jest.fn().mockResolvedValueOnce(variationMock).mockResolvedValueOnce(undefined);

      const result = await service.find(createRequest);

      expect(projectFindUniqueMock).toHaveBeenCalledWith({ where: { id: createRequest.projectId } });
      expect(service.findUnique).toHaveBeenNthCalledWith(1, {
        name: createRequest.name,
        projectId: createRequest.projectId,
        os: createRequest.os,
        browser: createRequest.browser,
        viewport: createRequest.viewport,
        device: createRequest.device,
        customTags: createRequest.customTags,
        branchName: projectMock.mainBranchName,
      });
      expect(service.findUnique).toHaveBeenNthCalledWith(2, {
        name: createRequest.name,
        projectId: createRequest.projectId,
        os: createRequest.os,
        browser: createRequest.browser,
        viewport: createRequest.viewport,
        device: createRequest.device,
        customTags: createRequest.customTags,
        branchName: createRequest.branchName,
      });
      expect(result).toBe(variationMock);
    });

    it('can find by current branch', async () => {
      const createRequest: CreateTestRequestDto = {
        buildId: 'buildId',
        projectId: projectMock.id,
        name: 'Test name',
        os: 'OS',
        browser: 'browser',
        viewport: 'viewport',
        device: 'device',
        customTags: '',
        branchName: 'develop',
      };

      const variationMock: TestVariation = {
        id: '123',
        projectId: projectMock.id,
        name: 'Test name',
        baselineName: 'baselineName',
        os: 'OS',
        browser: 'browser',
        viewport: 'viewport',
        device: 'device',
        customTags: '',
        ignoreAreas: '[]',
        comment: 'some comment',
        branchName: 'develop',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const projectFindUniqueMock = jest.fn().mockReturnValueOnce(projectMock);
      service = await initModule({ projectFindUniqueMock });
      service.findUnique = jest.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(variationMock);

      const result = await service.find(createRequest);

      expect(projectFindUniqueMock).toHaveBeenCalledWith({ where: { id: createRequest.projectId } });
      expect(service.findUnique).toHaveBeenNthCalledWith(1, {
        name: createRequest.name,
        projectId: createRequest.projectId,
        os: createRequest.os,
        browser: createRequest.browser,
        viewport: createRequest.viewport,
        device: createRequest.device,
        customTags: createRequest.customTags,
        branchName: projectMock.mainBranchName,
      });
      expect(service.findUnique).toHaveBeenNthCalledWith(2, {
        name: createRequest.name,
        projectId: createRequest.projectId,
        os: createRequest.os,
        browser: createRequest.browser,
        viewport: createRequest.viewport,
        device: createRequest.device,
        customTags: createRequest.customTags,
        branchName: createRequest.branchName,
      });
      expect(result).toBe(variationMock);
    });

    it('can find by current branch but main branch is more relevant', async () => {
      const createRequest: CreateTestRequestDto = {
        buildId: 'buildId',
        projectId: projectMock.id,
        name: 'Test name',
        os: 'OS',
        browser: 'browser',
        viewport: 'viewport',
        device: 'device',
        customTags: '',
        branchName: 'develop',
      };

      const variationMainMock: TestVariation = {
        id: '123',
        projectId: projectMock.id,
        name: 'Test name',
        baselineName: 'baselineName',
        os: 'OS',
        browser: 'browser',
        viewport: 'viewport',
        device: 'device',
        customTags: '',
        ignoreAreas: '[]',
        comment: 'some comment',
        branchName: 'master',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const variationFeatureMock: TestVariation = {
        id: '123',
        projectId: projectMock.id,
        name: 'Test name',
        baselineName: 'baselineName',
        os: 'OS',
        browser: 'browser',
        viewport: 'viewport',
        device: 'device',
        customTags: '',
        ignoreAreas: '[]',
        comment: 'some comment',
        branchName: 'develop',
        createdAt: new Date(),
        updatedAt: new Date(variationMainMock.updatedAt.getDate() - 1),
      };
      const projectFindUniqueMock = jest.fn().mockReturnValueOnce(projectMock);
      service = await initModule({ projectFindUniqueMock });
      service.findUnique = jest
        .fn()
        .mockResolvedValueOnce(variationMainMock)
        .mockResolvedValueOnce(variationFeatureMock);

      const result = await service.find(createRequest);

      expect(projectFindUniqueMock).toHaveBeenCalledWith({ where: { id: createRequest.projectId } });
      expect(service.findUnique).toHaveBeenNthCalledWith(1, {
        name: createRequest.name,
        projectId: createRequest.projectId,
        os: createRequest.os,
        browser: createRequest.browser,
        viewport: createRequest.viewport,
        device: createRequest.device,
        customTags: createRequest.customTags,
        branchName: projectMock.mainBranchName,
      });
      expect(service.findUnique).toHaveBeenNthCalledWith(2, {
        name: createRequest.name,
        projectId: createRequest.projectId,
        os: createRequest.os,
        browser: createRequest.browser,
        viewport: createRequest.viewport,
        device: createRequest.device,
        customTags: createRequest.customTags,
        branchName: createRequest.branchName,
      });
      expect(result).toBe(variationMainMock);
    });
  });

  it('create', async () => {
    const createRequest: CreateTestRequestDto = {
      buildId: 'buildId',
      projectId: projectMock.id,
      name: 'Test name',
      os: 'OS',
      browser: 'browser',
      viewport: 'viewport',
      device: 'device',
      customTags: '',
      branchName: 'develop',
    };

    const projectFindUniqueMock = jest.fn().mockReturnValueOnce(projectMock);
    const variationCreateMock = jest.fn();
    service = await initModule({ projectFindUniqueMock, variationCreateMock });
    service.findUnique = jest.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);

    await service.create({
      testRunId: 'testRunId',
      createTestRequestDto: createRequest,
    });

    expect(variationCreateMock).toHaveBeenCalledWith({
      data: {
        name: createRequest.name,
        os: createRequest.os,
        browser: createRequest.browser,
        viewport: createRequest.viewport,
        device: createRequest.device,
        customTags: createRequest.customTags,
        branchName: createRequest.branchName,
        testRuns: { connect: { id: 'testRunId' } },
        project: {
          connect: {
            id: createRequest.projectId,
          },
        },
      },
    });
  });

  it('update', async () => {
    const id = 'some id';
    const data: TestVariationUpdateDto = {
      baselineName: 'baselineName',
      comment: 'random comment',
      ignoreAreas: '[]',
    };
    const variationUpdateMock = jest.fn();
    service = await initModule({
      variationUpdateMock,
    });

    await service.update(id, data);

    expect(variationUpdateMock).toHaveBeenCalledWith({
      where: { id },
      data,
    });
  });

  it('merge', async () => {
    const fromBranch = 'develop';
    const targetBranch = 'test';
    const project: Project = TEST_PROJECT;
    const build: Build = {
      id: 'a9385fc1-884d-4f9f-915e-40da0e7773d5',
      ciBuildId: 'ciBuildId',
      number: null,
      branchName: targetBranch,
      status: null,
      projectId: project.id,
      updatedAt: new Date(),
      createdAt: new Date(),
      userId: null,
      isRunning: true,
    };
    const testVariation: TestVariation = {
      id: '123',
      projectId: project.id,
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
      branchName: fromBranch,
    };
    const testVariationSecond: TestVariation = {
      id: '123',
      projectId: project.id,
      name: 'Test name second',
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
      branchName: fromBranch,
    };
    const testVariationNoBaseline: TestVariation = {
      id: '123',
      projectId: project.id,
      name: 'Test name',
      baselineName: null,
      os: 'OS',
      browser: 'browser',
      viewport: 'viewport',
      device: 'device',
      customTags: '',
      ignoreAreas: '[]',
      comment: 'some comment',
      createdAt: new Date(),
      updatedAt: new Date(),
      branchName: fromBranch,
    };
    const testVariationSourceBranch: TestVariation = {
      id: '123',
      projectId: project.id,
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
      branchName: fromBranch,
    };
    const testVariationTargetBranch: TestVariation = {
      ...testVariationSourceBranch,
      branchName: targetBranch,
    };
    const buildFindOrCreateMock = jest.fn().mockResolvedValueOnce(build);
    const variationFindManyMock = jest
      .fn()
      .mockResolvedValueOnce([testVariation, testVariationSecond, testVariationNoBaseline]);
    const image = new PNG({
      width: 10,
      height: 10,
    });
    const imageBuffer = PNG.sync.write(image);
    const getImageBufferMock = jest
      .fn()
      .mockReturnValueOnce(imageBuffer)
      .mockReturnValueOnce(imageBuffer)
      .mockReturnValueOnce(null);
    const testRunCreateMock = jest.fn();
    const buildUpdateMock = jest.fn();
    const testRuncalCulateDiffMock = jest.fn();
    const service = await initModule({
      buildFindOrCreateMock,
      buildUpdateMock,
      testRunCreateMock,
      testRuncalCulateDiffMock,
      variationFindManyMock,
      getImageBufferMock,
    });
    service.find = jest
      .fn()
      .mockResolvedValueOnce(testVariationSourceBranch)
      .mockResolvedValueOnce(testVariationSourceBranch);
    service.create = jest
      .fn()
      .mockResolvedValueOnce(testVariationTargetBranch)
      .mockResolvedValueOnce(testVariationTargetBranch);

    await service.merge(project.id, fromBranch, targetBranch);

    expect(buildFindOrCreateMock).toHaveBeenCalledWith({
      branchName: targetBranch,
      projectId: project.id,
    });
    expect(service.find).toHaveBeenNthCalledWith(1, {
      name: testVariation.name,
      os: testVariation.os,
      device: testVariation.device,
      browser: testVariation.browser,
      viewport: testVariation.viewport,
      customTags: testVariation.customTags,
      branchName: targetBranch,
      projectId: project.id,
    });
    expect(service.find).toHaveBeenNthCalledWith(2, {
      name: testVariationSecond.name,
      os: testVariationSecond.os,
      device: testVariationSecond.device,
      browser: testVariationSecond.browser,
      viewport: testVariationSecond.viewport,
      customTags: testVariationSecond.customTags,
      branchName: targetBranch,
      projectId: project.id,
    });
    expect(testRunCreateMock).toHaveBeenNthCalledWith(1, {
      testVariation: testVariationTargetBranch,
      createTestRequestDto: {
        ...testVariation,
        branchName: targetBranch,
        buildId: build.id,
        diffTollerancePercent: 0,
        merge: true,
        ignoreAreas: JSON.parse(testVariation.ignoreAreas),
      },
      imageBuffer,
    });
    expect(testRunCreateMock).toHaveBeenNthCalledWith(2, {
      testVariation: testVariationTargetBranch,
      createTestRequestDto: {
        ...testVariationSecond,
        branchName: targetBranch,
        buildId: build.id,
        diffTollerancePercent: 0,
        merge: true,
        ignoreAreas: JSON.parse(testVariationSecond.ignoreAreas),
      },
      imageBuffer,
    });
    expect(testRunCreateMock).toHaveBeenCalledTimes(2);
    expect(buildUpdateMock).toHaveBeenCalledWith(build.id, { isRunning: false });
  });

  it('delete', async () => {
    const testRunId = 'test run id';
    const testVariationId = 'test variation id';
    const variation: TestVariation & {
      baselines: Baseline[];
    } = {
      id: testVariationId,
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
      branchName: 'develop',
      createdAt: new Date(),
      updatedAt: new Date(),
      baselines: [
        {
          id: 'baseline id 1',
          baselineName: 'image name 1',
          testVariationId: testVariationId,
          testRunId: testRunId,
          userId: 'userId',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };

    const $executeRawMock = jest.fn();
    const variationDeleteMock = jest.fn();
    const getDetailsMock = jest.fn().mockResolvedValueOnce(variation);
    const deleteBaselineMock = jest.fn().mockResolvedValueOnce(variation.baselines[0]);
    const service = await initModule({
      variationDeleteMock,
      $executeRawMock,
    });
    service.getDetails = getDetailsMock;
    service.deleteBaseline = deleteBaselineMock;

    await service.delete(testVariationId);

    expect(service.getDetails).toHaveBeenCalledWith(testVariationId);
    expect(service.deleteBaseline).toHaveBeenCalledWith(variation.baselines[0]);
    expect($executeRawMock).toHaveBeenCalled();
    expect(variationDeleteMock).toHaveBeenCalledWith({
      where: { id: testVariationId },
    });
  });

  it('deleteBaseline', async () => {
    const baseline: Baseline = {
      id: 'baseline id 1',
      baselineName: 'image name 1',
      testVariationId: 'test variation id',
      testRunId: 'test run id 1',
      userId: 'userId',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const baselineDeleteMock = jest.fn();
    const imageDeleteMock = jest.fn();
    const service = await initModule({
      baselineDeleteMock,
      imageDeleteMock,
    });

    await service.deleteBaseline(baseline);

    expect(imageDeleteMock).toHaveBeenCalledWith(baseline.baselineName);
    expect(baselineDeleteMock).toHaveBeenCalledWith({
      where: { id: baseline.id },
    });
  });

  describe('characterization', () => {
    const baselineData = {
      name: 'Test name',
      os: 'OS',
      browser: 'browser',
      viewport: 'viewport',
      device: 'device',
      customTags: 'tag',
    };

    it('findUnique looks the variation up by its full composite key', async () => {
      const variation = generateTestVariation();
      const variationfindUniqueMock = jest.fn().mockResolvedValueOnce(variation);
      service = await initModule({ variationfindUniqueMock });

      const result = await service.findUnique({ ...baselineData, projectId: 'projectId', branchName: 'develop' });

      expect(result).toBe(variation);
      expect(variationfindUniqueMock).toHaveBeenCalledWith({
        where: {
          projectId_name_browser_device_os_viewport_customTags_branchName: {
            projectId: 'projectId',
            ...baselineData,
            branchName: 'develop',
          },
        },
      });
    });

    describe('find', () => {
      it('returns undefined when neither branch has the variation', async () => {
        const projectFindUniqueMock = jest.fn().mockResolvedValueOnce(TEST_PROJECT);
        service = await initModule({ projectFindUniqueMock });
        service.findUnique = jest.fn().mockResolvedValue(null);

        // NOTE: current behavior — declared as `TestVariation | null` but resolves undefined
        await expect(
          service.find({ ...baselineData, projectId: TEST_PROJECT.id, branchName: 'develop' })
        ).resolves.toBeUndefined();
      });

      it('only looks on the main branch when the build runs on it', async () => {
        const variation = generateTestVariation({ branchName: TEST_PROJECT.mainBranchName });
        const projectFindUniqueMock = jest.fn().mockResolvedValueOnce(TEST_PROJECT);
        service = await initModule({ projectFindUniqueMock });
        service.findUnique = jest.fn().mockResolvedValueOnce(variation);

        const result = await service.find({
          ...baselineData,
          projectId: TEST_PROJECT.id,
          branchName: TEST_PROJECT.mainBranchName,
        });

        expect(result).toBe(variation);
        expect(service.findUnique).toHaveBeenCalledTimes(1);
        expect(service.findUnique).toHaveBeenCalledWith({
          ...baselineData,
          projectId: TEST_PROJECT.id,
          branchName: TEST_PROJECT.mainBranchName,
        });
      });

      it('uses sourceBranch instead of the project main branch when given', async () => {
        const projectFindUniqueMock = jest.fn().mockResolvedValueOnce(TEST_PROJECT);
        service = await initModule({ projectFindUniqueMock });
        service.findUnique = jest.fn().mockResolvedValue(null);

        await service.find({
          ...baselineData,
          projectId: TEST_PROJECT.id,
          branchName: 'feature',
          sourceBranch: 'release',
        });

        expect(projectFindUniqueMock).toHaveBeenCalledWith({ where: { id: TEST_PROJECT.id } });
        expect(service.findUnique).toHaveBeenNthCalledWith(1, expect.objectContaining({ branchName: 'release' }));
        expect(service.findUnique).toHaveBeenNthCalledWith(2, expect.objectContaining({ branchName: 'feature' }));
      });

      it('keeps the current branch variation when it is as new as the main branch one', async () => {
        const updatedAt = new Date('2024-01-01');
        const main = generateTestVariation({ id: 'main', updatedAt });
        const current = generateTestVariation({ id: 'current', updatedAt });
        const projectFindUniqueMock = jest.fn().mockResolvedValueOnce(TEST_PROJECT);
        service = await initModule({ projectFindUniqueMock });
        service.findUnique = jest.fn().mockResolvedValueOnce(main).mockResolvedValueOnce(current);

        await expect(
          service.find({ ...baselineData, projectId: TEST_PROJECT.id, branchName: 'develop' })
        ).resolves.toBe(current);
      });
    });

    it('update connects the test run when one is given', async () => {
      const variationUpdateMock = jest.fn().mockResolvedValueOnce('updated');
      service = await initModule({ variationUpdateMock });

      const result = await service.update(
        'variationId',
        { baselineName: 'baseline.png', ignoreAreas: '[]', comment: 'c' },
        'testRunId'
      );

      expect(result).toBe('updated');
      expect(variationUpdateMock).toHaveBeenCalledWith({
        where: { id: 'variationId' },
        data: {
          baselineName: 'baseline.png',
          ignoreAreas: '[]',
          comment: 'c',
          testRuns: { connect: { id: 'testRunId' } },
        },
      });
    });

    it('create leaves testRuns undefined without a test run id', async () => {
      const variationCreateMock = jest.fn();
      service = await initModule({ variationCreateMock });

      await service.create({
        createTestRequestDto: {
          ...baselineData,
          projectId: 'projectId',
          branchName: 'develop',
        } as CreateTestRequestDto,
      });

      expect(variationCreateMock.mock.calls[0][0].data).toStrictEqual({
        project: { connect: { id: 'projectId' } },
        testRuns: undefined,
        branchName: 'develop',
        ...baselineData,
      });
    });

    it('create stores missing optional fields as empty strings', async () => {
      const variationCreateMock = jest.fn();
      service = await initModule({ variationCreateMock });

      await service.create({
        createTestRequestDto: {
          name: 'only name',
          projectId: 'projectId',
          branchName: 'develop',
        } as CreateTestRequestDto,
      });

      expect(variationCreateMock.mock.calls[0][0].data).toMatchObject({
        name: 'only name',
        os: '',
        device: '',
        browser: '',
        viewport: '',
        customTags: '',
      });
    });

    it.each([
      ['a user', 'userId', { connect: { id: 'userId' } }],
      ['no user', undefined, undefined],
    ])('addBaseline records a baseline for the test run with %s', async (_, userId, user) => {
      const variationUpdateMock = jest.fn().mockResolvedValueOnce('updated');
      service = await initModule({ variationUpdateMock });

      const result = await service.addBaseline({
        id: 'variationId',
        userId,
        testRunId: 'testRunId',
        baselineName: 'baseline.png',
      });

      expect(result).toBe('updated');
      expect(variationUpdateMock.mock.calls[0][0]).toStrictEqual({
        where: { id: 'variationId' },
        data: {
          baselineName: 'baseline.png',
          baselines: {
            create: {
              baselineName: 'baseline.png',
              testRun: { connect: { id: 'testRunId' } },
              user,
            },
          },
        },
      });
    });

    it('merge reuses a variation that already lives on the target branch', async () => {
      const source = generateTestVariation({
        branchName: 'develop',
        ignoreAreas: '[{"x":1,"y":2,"width":3,"height":4}]',
      });
      const target = generateTestVariation({ id: 'target', branchName: 'master' });
      const build = { id: 'buildId' };
      const imageBuffer = Buffer.from('png');
      const testRun = { id: 'testRunId' };
      const buildFindOrCreateMock = jest.fn().mockResolvedValueOnce(build);
      const variationFindManyMock = jest.fn().mockResolvedValueOnce([source]);
      const getImageBufferMock = jest.fn().mockResolvedValueOnce(imageBuffer);
      const testRunCreateMock = jest.fn().mockResolvedValueOnce(testRun);
      const testRuncalCulateDiffMock = jest.fn();
      const buildUpdateMock = jest.fn().mockResolvedValueOnce('stopped build');
      service = await initModule({
        buildFindOrCreateMock,
        variationFindManyMock,
        getImageBufferMock,
        testRunCreateMock,
        testRuncalCulateDiffMock,
        buildUpdateMock,
      });
      service.find = jest.fn().mockResolvedValueOnce(target);
      service.create = jest.fn();

      const result = await service.merge('projectId', 'develop', 'master');

      expect(variationFindManyMock).toHaveBeenCalledWith({ where: { projectId: 'projectId', branchName: 'develop' } });
      expect(getImageBufferMock).toHaveBeenCalledWith(source.baselineName);
      expect(service.create).not.toHaveBeenCalled();
      expect(testRunCreateMock).toHaveBeenCalledWith({
        testVariation: target,
        createTestRequestDto: expect.objectContaining({
          branchName: 'master',
          buildId: 'buildId',
          merge: true,
          diffTollerancePercent: 0,
          ignoreAreas: [{ x: 1, y: 2, width: 3, height: 4 }],
        }),
        imageBuffer,
      });
      expect(testRuncalCulateDiffMock).toHaveBeenCalledWith('projectId', testRun);
      expect(buildUpdateMock).toHaveBeenCalledWith('buildId', { isRunning: false });
      expect(result).toBe('stopped build');
    });

    it('delete detaches the test runs with a raw update before deleting the variation', async () => {
      const $executeRawMock = jest.fn();
      const variationDeleteMock = jest.fn().mockResolvedValueOnce('deleted');
      service = await initModule({ $executeRawMock, variationDeleteMock });
      service.getDetails = jest.fn().mockResolvedValueOnce(generateTestVariation({ id: 'variationId' }, []));

      const result = await service.delete('variationId');

      const [strings, ...values] = $executeRawMock.mock.calls[0];
      expect(strings.join('?')).toBe(
        'UPDATE "public"."TestRun" SET "testVariationId" = NULL::text WHERE "testVariationId" = ?'
      );
      expect(values).toEqual(['variationId']);
      expect(result).toBe('deleted');
    });
  });
});
