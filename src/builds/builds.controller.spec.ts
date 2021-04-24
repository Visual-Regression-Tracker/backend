import { Test, TestingModule } from '@nestjs/testing';
import { BuildsController } from './builds.controller';
import { BuildsService } from './builds.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApiGuard } from '../auth/guards/api.guard';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { ProjectsService } from '../projects/projects.service';
import { TEST_BUILD, TEST_PROJECT } from '../_data_';
import { Build } from '.prisma/client';
import { BuildDto } from './dto/build.dto';
import { CreateBuildDto } from './dto/build-create.dto';
import { EventsGateway } from '../shared/events/events.gateway';

const initController = async ({
  projectFindOneMock = jest.fn(),
  buildFindOrCreateMock = jest.fn(),
  buildIncrementBuildNumberMock = jest.fn(),
  eventBuildCreatedMock = jest.fn(),
}) => {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [BuildsController],
    providers: [
      {
        provide: ProjectsService,
        useValue: {
          findOne: projectFindOneMock,
        },
      },
      {
        provide: BuildsService,
        useValue: {
          findOrCreate: buildFindOrCreateMock,
          incrementBuildNumber: buildIncrementBuildNumberMock,
        },
      },
      { provide: EventsGateway, useValue: { buildCreated: eventBuildCreatedMock } },
      { provide: PrismaService, useValue: {} },
      { provide: ApiGuard, useValue: {} },
      { provide: JwtAuthGuard, useValue: {} },
    ],
  }).compile();

  return module.get<BuildsController>(BuildsController);
};
describe('Builds Controller', () => {
  let controller: BuildsController;

  const createBuildDto: CreateBuildDto = {
    ciBuildId: 'ciBuildId',
    branchName: 'branchName',
    project: 'name',
  };
  const project = TEST_PROJECT;
  const newBuild: Build = {
    ...TEST_BUILD,
    number: null,
  };
  const buildWithNumber: Build = {
    ...TEST_BUILD,
    number: 12,
  };

  beforeEach(async () => {});

  it('should be defined', async () => {
    controller = await initController({});
    expect(controller).toBeDefined();
  });

  it('should create new build', async () => {
    const eventBuildCreatedMock = jest.fn();
    const projectFindOneMock = jest.fn().mockResolvedValueOnce(project);
    const buildFindOrCreateMock = jest.fn().mockResolvedValueOnce(newBuild);
    const buildIncrementBuildNumberMock = jest.fn().mockResolvedValueOnce(buildWithNumber);
    controller = await initController({
      projectFindOneMock,
      buildFindOrCreateMock,
      buildIncrementBuildNumberMock,
      eventBuildCreatedMock,
    });

    const result = await controller.create(createBuildDto);

    expect(result).toStrictEqual(new BuildDto(buildWithNumber));
    expect(buildIncrementBuildNumberMock).toHaveBeenCalledWith(newBuild.id, project.id);
    expect(eventBuildCreatedMock).toHaveBeenCalledWith(new BuildDto(buildWithNumber));
  });

  it('should reuse build', async () => {
    const eventBuildCreatedMock = jest.fn();
    const projectFindOneMock = jest.fn().mockResolvedValueOnce(project);
    const buildFindOrCreateMock = jest.fn().mockResolvedValueOnce(buildWithNumber);
    controller = await initController({
      projectFindOneMock,
      buildFindOrCreateMock,
      eventBuildCreatedMock,
    });

    const result = await controller.create(createBuildDto);

    expect(result).toStrictEqual(new BuildDto(buildWithNumber));
  });
});
