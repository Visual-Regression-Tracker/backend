import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Build, Prisma, TestStatus } from '@prisma/client';
import { TestRunsService } from '../test-runs/test-runs.service';
import { EventsGateway } from '../shared/events/events.gateway';
import { BuildDto } from './dto/build.dto';
import { PaginatedBuildDto } from './dto/build-paginated.dto';
import { ModifyBuildDto } from './dto/build-modify.dto';

@Injectable()
export class BuildsService {
  private readonly logger: Logger = new Logger(BuildsService.name);
  private readonly ongoingDeletions = new Map<string, Promise<void>>();

  constructor(
    private prismaService: PrismaService,
    private eventsGateway: EventsGateway,
    @Inject(forwardRef(() => TestRunsService))
    private testRunsService: TestRunsService
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

  async update(id: string, modifyBuildDto: ModifyBuildDto): Promise<BuildDto> {
    await this.prismaService.build.update({
      where: { id },
      data: modifyBuildDto,
    });
    this.eventsGateway.buildUpdated(id);
    return this.findOne(id);
  }

  async remove(id: string): Promise<Build> {
    if (!id) {
      this.logger.warn(`Attempted to remove build with undefined ID.`);
      return;
    }
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

    await Promise.all(build.testRuns.map((testRun) => this.testRunsService.delete(testRun.id)));

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

  async deleteOldBuilds(projectId: string, keepBuilds: number): Promise<void> {
    if (this.ongoingDeletions.has(projectId)) {
      this.logger.debug(`Deletion for project ${projectId} is already in progress. Returning existing promise.`);
      return this.ongoingDeletions.get(projectId);
    }

    const deletionPromise = (async () => {
      this.logger.debug(`Starting to delete old builds for project ${projectId}, keeping ${keepBuilds} builds.`);
      keepBuilds = keepBuilds < 2 ? keepBuilds : keepBuilds - 1;
      const buildList = await this.findMany(projectId, undefined, keepBuilds);
      for (const eachBuild of buildList.data) {
        await this.remove(eachBuild.id);
      }
      this.logger.debug(`Finished deleting old builds for project ${projectId}.`);
    })();

    this.ongoingDeletions.set(projectId, deletionPromise);

    deletionPromise.finally(() => {
      this.ongoingDeletions.delete(projectId);
      this.logger.debug(`Deletion promise for project ${projectId} resolved/rejected and removed from map.`);
    });

    return deletionPromise;
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
