import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { CreateBuildDto } from './dto/build-create.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Build } from '@prisma/client';
import { TestRunsService } from '../test-runs/test-runs.service';
import { EventsGateway } from '../shared/events/events.gateway';
import { BuildDto } from './dto/build.dto';
import { ProjectsService } from '../projects/projects.service';

@Injectable()
export class BuildsService {
  constructor(
    private prismaService: PrismaService,
    private eventsGateway: EventsGateway,
    @Inject(forwardRef(() => TestRunsService))
    private testRunsService: TestRunsService,
    @Inject(forwardRef(() => ProjectsService))
    private projectService: ProjectsService
  ) {}

  async findMany(projectId: string): Promise<BuildDto[]> {
    const buildList = await this.prismaService.build.findMany({
      where: { projectId },
      include: {
        testRuns: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return buildList.map((build) => new BuildDto(build));
  }

  async create(createBuildDto: CreateBuildDto): Promise<BuildDto> {
    // find project
    let project = await this.projectService.findOne(createBuildDto.project);

    // increment build number
    project = await this.prismaService.project.update({
      where: {
        id: project.id,
      },
      data: {
        buildsCounter: {
          increment: 1,
        },
      },
    });

    // get or create build
    const buildId = createBuildDto.id || '';
    const build = await this.prismaService.build.upsert({
      create: {
        branchName: createBuildDto.branchName,
        isRunning: true,
        number: project.buildsCounter,
        project: {
          connect: {
            id: project.id,
          },
        },
      },
      update: {},
      where: {
        id: buildId,
      },
    });
    const buildDto = new BuildDto(build);
    this.eventsGateway.buildCreated(buildDto);
    return buildDto;
  }

  async stop(id: string): Promise<BuildDto> {
    const build = await this.prismaService.build.update({
      where: { id },
      include: {
        testRuns: true,
      },
      data: {
        isRunning: false,
      },
    });
    const buildDto = new BuildDto(build);
    this.eventsGateway.buildFinished(buildDto);
    return buildDto;
  }

  async remove(id: string): Promise<Build> {
    const build = await this.prismaService.build.findOne({
      where: { id },
      include: {
        testRuns: true,
      },
    });

    await Promise.all(build.testRuns.map((testRun) => this.testRunsService.delete(testRun.id)));

    return this.prismaService.build.delete({
      where: { id },
    });
  }
}
