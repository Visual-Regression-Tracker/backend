import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { CreateBuildDto } from './dto/build-create.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Build, TestStatus } from '@prisma/client';
import { TestRunsService } from '../test-runs/test-runs.service';
import { EventsGateway } from '../shared/events/events.gateway';
import { BuildDto } from './dto/build.dto';
import { ProjectsService } from '../projects/projects.service';
import { PaginatedBuildDto } from './dto/build-paginated.dto';
import { ModifyBuildDto } from './dto/build-modify.dto';

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

  async findOne(id: string): Promise<BuildDto> {
    const [build, testRuns] = await Promise.all([
      this.prismaService.build.findUnique({
        where: { id },
      }),
      this.testRunsService.findMany(id),
    ]);
    return new BuildDto({
      ...build,
      testRuns,
    });
  }

  async findMany(projectId: string, take: number, skip: number): Promise<PaginatedBuildDto> {
    const [total, buildList] = await Promise.all([
      this.prismaService.build.count({ where: { projectId } }),
      this.prismaService.build.findMany({
        where: { projectId },
        take,
        skip,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      data: await Promise.all(buildList.map((build) => this.findOne(build.id))),
      total,
      take,
      skip,
    };
  }

  async create(createBuildDto: CreateBuildDto): Promise<BuildDto> {
    let project = await this.projectService.findOne(createBuildDto.project);

    let build: Build;
    if (createBuildDto.ciBuildId) {
      build = await this.prismaService.build.findUnique({
        where: {
          projectId_ciBuildId: {
            projectId: project.id,
            ciBuildId: createBuildDto.ciBuildId,
          },
        },
      });
    }

    if (!build) {
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

      build = await this.prismaService.build.create({
        data: {
          ciBuildId: createBuildDto.ciBuildId,
          branchName: createBuildDto.branchName,
          isRunning: true,
          number: project.buildsCounter,
          project: {
            connect: {
              id: project.id,
            },
          },
        },
      });

      this.eventsGateway.buildCreated(new BuildDto(build));
    }
    return new BuildDto(build);
  }

  async update(id: string, modifyBuildDto: ModifyBuildDto): Promise<BuildDto> {
    await this.prismaService.build.update({
      where: { id },
      data: modifyBuildDto,
    });
    this.eventsGateway.buildUpdated(id);
    return this.findOne(id);
  }

  async remove(id: string): Promise<Build> {
    const build = await this.prismaService.build.findUnique({
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

  async approve(id: string, merge: boolean): Promise<void> {
    const build = await this.prismaService.build.findUnique({
      where: { id },
      include: {
        testRuns: {
          where: {
            status: {
              in: [TestStatus.new, TestStatus.unresolved],
            },
          },
        },
      },
    });

    for(const testRun of build.testRuns) {
      await this.testRunsService.approve(testRun.id, merge)
    }
  }
}
