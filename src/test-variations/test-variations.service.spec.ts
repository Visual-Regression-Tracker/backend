import { Test, TestingModule } from '@nestjs/testing';
import { TestVariationsService } from './test-variations.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTestRequestDto } from '../test-runs/dto/create-test-request.dto';
import { StaticService } from '../shared/static/static.service';
import { IgnoreAreaDto } from '../test-runs/dto/ignore-area.dto';
import { TestVariation, Baseline, Project } from '@prisma/client';
import { CommentDto } from '../shared/dto/comment.dto';
import { convertBaselineDataToQuery } from '../shared/dto/baseline-data.dto';

const initModule = async ({
  imageDeleteMock = jest.fn(),
  variationFindOneMock = jest.fn,
  variationFindManyMock = jest.fn().mockReturnValue([]),
  variationCreateMock = jest.fn(),
  variationUpdateMock = jest.fn(),
  variationDeleteMock = jest.fn(),
  baselineDeleteMock = jest.fn(),
  projectFindOneMock = jest.fn(),
}) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TestVariationsService,
      {
        provide: StaticService,
        useValue: {
          deleteImage: imageDeleteMock,
        },
      },
      {
        provide: PrismaService,
        useValue: {
          testVariation: {
            findOne: variationFindOneMock,
            findMany: variationFindManyMock,
            create: variationCreateMock,
            update: variationUpdateMock,
            delete: variationDeleteMock,
          },
          baseline: {
            delete: baselineDeleteMock,
          },
          project: {
            findOne: projectFindOneMock,
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
      const variationFindOneMock = jest.fn();
      service = await initModule({ variationFindOneMock });

      await service.getDetails(id);

      expect(variationFindOneMock).toHaveBeenCalledWith({
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
    const projectMock: Project = {
      id: '12',
      name: 'Project',
      mainBranchName: 'master',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('can find by main branch', async () => {
      const createRequest: CreateTestRequestDto = {
        buildId: 'buildId',
        projectId: projectMock.id,
        name: 'Test name',
        imageBase64: 'Image',
        os: 'OS',
        browser: 'browser',
        viewport: 'viewport',
        device: 'device',
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
        ignoreAreas: '[]',
        comment: 'some comment',
        branchName: 'develop',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const variationFindManyMock = jest
        .fn()
        .mockResolvedValueOnce([variationMock])
        .mockResolvedValueOnce([undefined]);
      const projectFindOneMock = jest.fn().mockReturnValueOnce(projectMock);
      service = await initModule({ variationFindManyMock, projectFindOneMock });

      const result = await service.findOrCreate(createRequest.projectId, convertBaselineDataToQuery(createRequest));

      expect(projectFindOneMock).toHaveBeenCalledWith({ where: { id: createRequest.projectId } });
      expect(variationFindManyMock).toHaveBeenNthCalledWith(1, {
        where: {
          name: createRequest.name,
          projectId: createRequest.projectId,
          os: createRequest.os,
          browser: createRequest.browser,
          viewport: createRequest.viewport,
          device: createRequest.device,
          branchName: projectMock.mainBranchName,
        },
      });
      expect(variationFindManyMock).toHaveBeenNthCalledWith(2, {
        where: {
          name: createRequest.name,
          projectId: createRequest.projectId,
          os: createRequest.os,
          browser: createRequest.browser,
          viewport: createRequest.viewport,
          device: createRequest.device,
          branchName: createRequest.branchName,
        },
      });
      expect(result).toBe(variationMock);
    });

    it('can find by current branch', async () => {
      const createRequest: CreateTestRequestDto = {
        buildId: 'buildId',
        projectId: projectMock.id,
        name: 'Test name',
        imageBase64: 'Image',
        os: 'OS',
        browser: 'browser',
        viewport: 'viewport',
        device: 'device',
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
        ignoreAreas: '[]',
        comment: 'some comment',
        branchName: 'develop',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const variationFindManyMock = jest
        .fn()
        .mockResolvedValueOnce([undefined])
        .mockResolvedValueOnce([variationMock]);
      const projectFindOneMock = jest.fn().mockReturnValueOnce(projectMock);
      service = await initModule({ variationFindManyMock, projectFindOneMock });

      const result = await service.findOrCreate(createRequest.projectId, convertBaselineDataToQuery(createRequest));

      expect(projectFindOneMock).toHaveBeenCalledWith({ where: { id: createRequest.projectId } });
      expect(variationFindManyMock).toHaveBeenNthCalledWith(1, {
        where: {
          name: createRequest.name,
          projectId: createRequest.projectId,
          os: createRequest.os,
          browser: createRequest.browser,
          viewport: createRequest.viewport,
          device: createRequest.device,
          branchName: projectMock.mainBranchName,
        },
      });
      expect(variationFindManyMock).toHaveBeenNthCalledWith(2, {
        where: {
          name: createRequest.name,
          projectId: createRequest.projectId,
          os: createRequest.os,
          browser: createRequest.browser,
          viewport: createRequest.viewport,
          device: createRequest.device,
          branchName: createRequest.branchName,
        },
      });
      expect(result).toBe(variationMock);
    });

    it('can create if not found', async () => {
      const createRequest: CreateTestRequestDto = {
        buildId: 'buildId',
        projectId: projectMock.id,
        name: 'Test name',
        imageBase64: 'Image',
        os: 'OS',
        browser: 'browser',
        viewport: 'viewport',
        device: 'device',
        branchName: 'develop',
      };

      const variationFindManyMock = jest
        .fn()
        .mockResolvedValueOnce([undefined])
        .mockResolvedValueOnce([undefined]);
      const projectFindOneMock = jest.fn().mockReturnValueOnce(projectMock);
      const variationCreateMock = jest.fn();
      service = await initModule({ variationFindManyMock, projectFindOneMock, variationCreateMock });

      const result = await service.findOrCreate(createRequest.projectId, convertBaselineDataToQuery(createRequest));

      expect(variationCreateMock).toHaveBeenCalledWith({
        data: {
          name: createRequest.name,
          os: createRequest.os,
          browser: createRequest.browser,
          viewport: createRequest.viewport,
          device: createRequest.device,
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

  describe('remove', () => {
    it('can remove', async () => {
      const id = 'test id';
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
        comment: 'some comment',
        branchName: 'develop',
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
        ],
      };
      const variationFindOneMock = jest.fn();
      const variationDeleteMock = jest.fn();
      const imageDeleteMock = jest.fn();
      const baselineDeleteMock = jest.fn();
      service = await initModule({
        variationFindOneMock: variationFindOneMock.mockResolvedValueOnce(variation),
        variationDeleteMock,
        imageDeleteMock,
        baselineDeleteMock,
      });

      await service.remove(id);

      expect(imageDeleteMock).toHaveBeenCalledWith(variation.baselines[0].baselineName);
      expect(baselineDeleteMock).toHaveBeenCalledWith({
        where: { id: variation.baselines[0].id },
      });
      expect(variationDeleteMock).toHaveBeenCalledWith({
        where: { id: variation.id },
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
});
