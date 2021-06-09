import { Test, TestingModule } from '@nestjs/testing';
import { TestVariationsService } from './test-variations.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTestRequestDto } from '../test-runs/dto/create-test-request.dto';
import { StaticService } from '../shared/static/static.service';
import { IgnoreAreaDto } from '../test-runs/dto/ignore-area.dto';
import { TestVariation, Baseline, Project, Build } from '@prisma/client';
import { CommentDto } from '../shared/dto/comment.dto';
import { CustomTagsDto } from '../shared/dto/custom-tags.dto';
import { PNG } from 'pngjs';
import { BuildsService } from '../builds/builds.service';
import { TestRunsService } from '../test-runs/test-runs.service';
import { getTestVariationUniqueData } from '../utils';
import { TEST_PROJECT } from '../_data_';

const initModule = async ({
  imageDeleteMock = jest.fn(),
  getImageMock = jest.fn(),
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
  $executeRawMock = jest.fn(),
}) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TestVariationsService,
      {
        provide: StaticService,
        useValue: {
          getImage: getImageMock,
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
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
      });
    });
  });

  describe('findOrCreate', () => {
    const projectMock = TEST_PROJECT;

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

      const result = await service.findOrCreate(createRequest.projectId, {
        ...getTestVariationUniqueData(createRequest),
        branchName: createRequest.branchName,
      });

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

      const result = await service.findOrCreate(createRequest.projectId, {
        ...getTestVariationUniqueData(createRequest),
        branchName: createRequest.branchName,
      });

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
        customTags:'',
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

      const result = await service.findOrCreate(createRequest.projectId, {
        ...getTestVariationUniqueData(createRequest),
        branchName: createRequest.branchName,
      });

      expect(projectFindUniqueMock).toHaveBeenCalledWith({ where: { id: createRequest.projectId } });
      expect(service.findUnique).toHaveBeenNthCalledWith(1, {
        name: createRequest.name,
        projectId: createRequest.projectId,
        os: createRequest.os,
        browser: createRequest.browser,
        viewport: createRequest.viewport,
        device: createRequest.device,
        customTags:createRequest.customTags,
        branchName: projectMock.mainBranchName,
      });
      expect(service.findUnique).toHaveBeenNthCalledWith(2, {
        name: createRequest.name,
        projectId: createRequest.projectId,
        os: createRequest.os,
        browser: createRequest.browser,
        viewport: createRequest.viewport,
        device: createRequest.device,
        customTags:createRequest.customTags,
        branchName: createRequest.branchName,
      });
      expect(result).toBe(variationMainMock);
    });

    it('can create if not found', async () => {
      const createRequest: CreateTestRequestDto = {
        buildId: 'buildId',
        projectId: projectMock.id,
        name: 'Test name',
        os: 'OS',
        browser: 'browser',
        viewport: 'viewport',
        device: 'device',
        customTags : '',
        branchName: 'develop',
      };

      const projectFindUniqueMock = jest.fn().mockReturnValueOnce(projectMock);
      const variationCreateMock = jest.fn();
      service = await initModule({ projectFindUniqueMock, variationCreateMock });
      service.findUnique = jest.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);

      await service.findOrCreate(createRequest.projectId, {
        ...getTestVariationUniqueData(createRequest),
        branchName: createRequest.branchName,
      });

      expect(variationCreateMock).toHaveBeenCalledWith({
        data: {
          name: createRequest.name,
          os: createRequest.os,
          browser: createRequest.browser,
          viewport: createRequest.viewport,
          device: createRequest.device,
          customTags:createRequest.customTags,
          branchName: createRequest.branchName,
          project: {
            connect: {
              id: createRequest.projectId,
            },
          },
        },
      });
    });
  });

  describe('updateIgnoreAreas', () => {
    it('can update', async () => {
      const id = 'test id';
      const ignoreAreas: IgnoreAreaDto[] = [
        {
          x: 1,
          y: 2.3,
          width: 442.1,
          height: 32.0,
        },
      ];
      const variationUpdateMock = jest.fn();
      service = await initModule({ variationUpdateMock });

      await service.updateIgnoreAreas(id, ignoreAreas);

      expect(variationUpdateMock).toBeCalledWith({
        where: {
          id,
        },
        data: {
          ignoreAreas: JSON.stringify(ignoreAreas),
        },
      });
    });
  });

  it('updateComment', async () => {
    const id = 'some id';
    const commentDto: CommentDto = {
      comment: 'random comment',
    };
    const variationUpdateMock = jest.fn();
    service = await initModule({
      variationUpdateMock,
    });

    await service.updateComment(id, commentDto);

    expect(variationUpdateMock).toHaveBeenCalledWith({
      where: { id },
      data: {
        comment: commentDto.comment,
      },
    });
  });

  it('updateCustomTags', async () => {
    const id = 'some id';
    const customTagsDto: CustomTagsDto = {
      customTags: 'random tag',
    };
    const variationUpdateMock = jest.fn();
    service = await initModule({
      variationUpdateMock,
    });

    await service.updateCustomTags(id, customTagsDto);

    expect(variationUpdateMock).toHaveBeenCalledWith({
      where: { id },
      data: {
        customTags: customTagsDto.customTags,
      },
    });
  });

  it('merge', async () => {
    const mergedBranch = 'develop';
    const project: Project = TEST_PROJECT;
    const build: Build = {
      id: 'a9385fc1-884d-4f9f-915e-40da0e7773d5',
      ciBuildId: 'ciBuildId',
      number: null,
      branchName: project.mainBranchName,
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
      branchName: mergedBranch,
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
      branchName: mergedBranch,
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
      branchName: mergedBranch,
    };
    const testVariationMainBranch: TestVariation = {
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
      branchName: project.mainBranchName,
    };
    const projectFindUniqueMock = jest.fn().mockResolvedValueOnce(project);
    const buildFindOrCreateMock = jest.fn().mockResolvedValueOnce(build);
    const variationFindManyMock = jest
      .fn()
      .mockResolvedValueOnce([testVariation, testVariationSecond, testVariationNoBaseline]);
    const image = new PNG({
      width: 10,
      height: 10,
    });
    const getImageMock = jest.fn().mockReturnValueOnce(image).mockReturnValueOnce(image).mockReturnValueOnce(null);
    const findOrCreateMock = jest
      .fn()
      .mockResolvedValueOnce(testVariationMainBranch)
      .mockResolvedValueOnce(testVariationMainBranch);
    const testRunCreateMock = jest.fn();
    const buildUpdateMock = jest.fn();
    const service = await initModule({
      projectFindUniqueMock,
      buildFindOrCreateMock,
      buildUpdateMock,
      testRunCreateMock,
      variationFindManyMock,
      getImageMock,
    });
    service.findOrCreate = findOrCreateMock;

    await service.merge(project.id, mergedBranch);

    expect(projectFindUniqueMock).toHaveBeenCalledWith({ where: { id: project.id } });
    expect(buildFindOrCreateMock).toHaveBeenCalledWith({
      branchName: project.mainBranchName,
      projectId: project.id,
    });
    expect(variationFindManyMock).toHaveBeenCalledWith({
      where: { projectId: project.id, branchName: mergedBranch },
    });
    expect(getImageMock).toHaveBeenCalledWith(testVariation.baselineName);
    expect(service.findOrCreate).toHaveBeenCalledWith(project.id, {
      name: testVariation.name,
      os: testVariation.os,
      device: testVariation.device,
      browser: testVariation.browser,
      viewport: testVariation.viewport,
      customTags:testVariation.customTags,
      branchName: project.mainBranchName,
    });

    await new Promise((r) => setTimeout(r, 1));
    expect(testRunCreateMock).toHaveBeenNthCalledWith(1, {
      testVariation: testVariationMainBranch,
      createTestRequestDto: {
        ...testVariation,
        buildId: build.id,
        diffTollerancePercent: 0,
        merge: true,
        ignoreAreas: JSON.parse(testVariation.ignoreAreas),
      },
      imageBuffer: PNG.sync.write(image),
    });
    expect(testRunCreateMock).toHaveBeenNthCalledWith(2, {
      testVariation: testVariationMainBranch,
      createTestRequestDto: {
        ...testVariationSecond,
        buildId: build.id,
        diffTollerancePercent: 0,
        merge: true,
        ignoreAreas: JSON.parse(testVariationSecond.ignoreAreas),
      },
      imageBuffer: PNG.sync.write(image),
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
          testRunId: 'test run id 1',
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
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const baselineDeleteMock = jest.fn();
    const imageDeleteMock = jest.fn();
    const testRunFindMany = jest.fn().mockResolvedValueOnce([]);
    const service = await initModule({
      baselineDeleteMock,
      imageDeleteMock,
      testRunFindMany,
    });

    await service.deleteBaseline(baseline);

    expect(imageDeleteMock).toHaveBeenCalledWith(baseline.baselineName);
    expect(baselineDeleteMock).toHaveBeenCalledWith({
      where: { id: baseline.id },
    });
  });
});
