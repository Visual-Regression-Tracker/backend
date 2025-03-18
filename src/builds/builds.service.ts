import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Build, Prisma, TestStatus, Project } from '@prisma/client';
import { TestRunsService } from '../test-runs/test-runs.service';
import { EventsGateway } from '../shared/events/events.gateway';
import { BuildDto } from './dto/build.dto';
import { PaginatedBuildDto } from './dto/build-paginated.dto';
import { ModifyBuildDto } from './dto/build-modify.dto';
import { StaticService } from '../static/static.service';

@Injectable()
export class BuildsService {
  private readonly logger: Logger = new Logger(BuildsService.name);

  constructor(
    private prismaService: PrismaService,
    private eventsGateway: EventsGateway,
    @Inject(forwardRef(() => TestRunsService))
    private testRunsService: TestRunsService,
    private staticService: StaticService
  ) {}

  async findOne(id: string): Promise<BuildDto> {
    const build = await this.prismaService.build.findUnique({
      where: { id },
      include: {
        testRuns: true,
      },
    });
    return new BuildDto(build);
  }

  async findMany(projectId: string, take: number, skip: number): Promise<PaginatedBuildDto> {
    const [total, buildList] = await Promise.all([
      this.prismaService.build.count({ where: { projectId } }),
      this.prismaService.build.findMany({
        where: { projectId },
        take,
        skip,
        orderBy: { createdAt: 'desc' },
        include: { testRuns: true },
      }),
    ]);

    return {
      data: buildList.map((build) => new BuildDto(build)),
      total,
      take,
      skip,
    };
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
    this.logger.debug(`Going to remove Build ${id}`);

    const build = await this.prismaService.build.findUnique({
      where: { id },
      include: {
        testRuns: true,
      },
    });

    if (!build) {
      this.logger.warn(`Build not found ${id}`);
      return;
    }

    await this.deleteBulkTestRuns([build.id]);

    try {
      await this.prismaService.build.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        // workaround https://github.com/Visual-Regression-Tracker/Visual-Regression-Tracker/issues/435
        if (e.code === 'P2025') {
          this.logger.warn(`Build already deleted ${id}`);
          return;
        }
      }
    }

    this.logger.log(`Build deleted ${id}`);
    this.eventsGateway.buildDeleted(new BuildDto({ ...build }));
    return build;
  }

  async deleteBulkTestRuns(buildIds: string[]) {
    const testRunsToDelete = await this.prismaService.testRun.findMany({ where: { buildId: { in: buildIds } } });

    await this.prismaService.testRun.deleteMany({ where: { buildId: { in: buildIds } } });

    testRunsToDelete.forEach((testRun) => {
      this.staticService.deleteImage(testRun.diffName);
      this.staticService.deleteImage(testRun.imageName);
    });

    testRunsToDelete.forEach((testRun) => {
      this.logger.log(`TestRun deleted ${testRun.id}`);
      this.eventsGateway.testRunDeleted(testRun);
    });
  }

  async deleteOldBuilds(project: Project) {
    this.logger.log('Going to delete old builds');

    const keepBuilds = project.maxBuildAllowed <= 1 ? 1 : project.maxBuildAllowed - 1;

    const buildsToDelete = await this.prismaService.build.findMany({
      where: { projectId: { equals: project.id } },
      orderBy: { createdAt: 'desc' },
      skip: keepBuilds,
    });

    const buildIds = buildsToDelete.map((build) => build.id);

    await this.deleteBulkTestRuns(buildIds);

    await this.prismaService.build.deleteMany({ where: { id: { in: buildIds } } });

    buildsToDelete.forEach((build) => {
      this.logger.log(`Build deleted ${build.id}`);
      this.eventsGateway.buildDeleted(new BuildDto({ ...build }));
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

    for (const testRun of build.testRuns) {
      await this.testRunsService.approve(testRun.id, merge);
    }
  }

  async findOrCreate({
    projectId,
    branchName,
    ciBuildId,
  }: {
    projectId: string;
    branchName: string;
    ciBuildId?: string;
  }): Promise<Build> {
    const where: Prisma.BuildWhereUniqueInput = ciBuildId
      ? {
          projectId_ciBuildId: {
            projectId,
            ciBuildId,
          },
        }
      : { id: projectId };

    let build: Build;
    try {
      build = await this.prismaService.build.upsert({
        where,
        create: {
          ciBuildId,
          branchName,
          isRunning: true,
          project: {
            connect: {
              id: projectId,
            },
          },
        },
        update: {
          isRunning: true,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') {
          // cuncurent upsert workaround https://www.prisma.io/docs/reference/api-reference/prisma-client-reference#unique-key-constraint-errors-on-upserts
          build = await this.prismaService.build.update({
            where,
            data: {
              isRunning: true,
            },
          });
        }
      }
    }

    // assigne build number
    if (!build.number) {
      build = await this.incrementBuildNumber(build.id, projectId);
      this.eventsGateway.buildCreated(new BuildDto(build));
    }

    return build;
  }

  async incrementBuildNumber(buildId: string, projectId: string): Promise<Build> {
    const project = await this.prismaService.project.update({
      where: {
        id: projectId,
      },
      data: {
        buildsCounter: {
          increment: 1,
        },
      },
    });
    return this.prismaService.build.update({
      where: { id: buildId },
      data: { number: project.buildsCounter },
    });
  }
}
