import { forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Build, Prisma, TestStatus } from '@prisma/client';
import { TestRunsService } from '../test-runs/test-runs.service';
import { EventsGateway } from '../shared/events/events.gateway';
import { BuildDto } from './dto/build.dto';
import { getBuildsStats } from './build-stats';
import { PaginatedBuildDto } from './dto/build-paginated.dto';
import { ModifyBuildDto } from './dto/build-modify.dto';

// Newest first, with the id to break a tie: without a total order two builds
// made in the same instant have no fixed place, so an offset page could show
// one of them twice or not at all, and the page a build sits on would be a
// matter of chance.
const BUILD_ORDER: Prisma.BuildOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'desc' }];

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
    const [build, stats] = await Promise.all([
      this.prismaService.build.findUnique({
        where: { id },
      }),
      getBuildsStats(this.prismaService, [id]),
    ]);
    if (!build) {
      throw new NotFoundException(`Build not found: ${id}`);
    }
    return new BuildDto(build, stats.get(id));
  }

  async findMany(
    projectId: string,
    // undefined reads every build, which is how deleteOldBuilds finds the ones past the limit
    take: number | undefined,
    skip: number,
    ciBuildId?: string,
    aroundBuildId?: string
  ): Promise<PaginatedBuildDto> {
    const where: Prisma.BuildWhereInput = {
      projectId,
      ...(ciBuildId && {
        ciBuildId: { contains: ciBuildId, mode: Prisma.QueryMode.insensitive },
      }),
    };

    // A link carries a build, not a page, so the page has to be worked out from
    // the build before anything is read.
    // the controller always sends take with aroundBuildId; deleteOldBuilds sends neither
    const pageSkip = aroundBuildId ? ((await this.skipToPageWith(where, take!, aroundBuildId)) ?? skip) : skip;

    const [total, buildList] = await Promise.all([
      this.prismaService.build.count({ where }),
      this.prismaService.build.findMany({
        where,
        take,
        skip: pageSkip,
        orderBy: BUILD_ORDER,
      }),
    ]);

    return {
      data: await Promise.all(buildList.map((build) => this.findOne(build.id))),
      total,
      // only deleteOldBuilds leaves take unset, and it reads just the data
      take: take!,
      skip: pageSkip,
    };
  }

  /**
   * Where the page holding this build starts, or null when there is no such
   * page: the build has been deleted, belongs elsewhere, or the search in force
   * leaves it out. A stale link should then open the list it asked for rather
   * than fail.
   */
  private async skipToPageWith(where: Prisma.BuildWhereInput, take: number, buildId: string): Promise<number | null> {
    if (take < 1) {
      return null;
    }

    const build = await this.prismaService.build.findFirst({
      where: { ...where, id: buildId },
      select: { id: true, createdAt: true },
    });
    if (!build) {
      return null;
    }

    // BUILD_ORDER puts a build ahead of this one when it is newer, or was made
    // in the same instant and carries the larger id. Counting those gives the
    // build's place in the list, and the page follows from the page size.
    const ahead = await this.prismaService.build.count({
      where: {
        ...where,
        OR: [{ createdAt: { gt: build.createdAt } }, { createdAt: build.createdAt, id: { gt: build.id } }],
      },
    });

    return Math.floor(ahead / take) * take;
  }

  async update(id: string, modifyBuildDto: ModifyBuildDto): Promise<BuildDto> {
    await this.prismaService.build.update({
      where: { id },
      // named one by one so nothing else a caller passes can reach the row
      data: { ciBuildId: modifyBuildDto.ciBuildId, isRunning: modifyBuildDto.isRunning },
    });
    this.eventsGateway.buildUpdated(id);
    return this.findOne(id);
  }

  async remove(id: string): Promise<Build | undefined> {
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

    if (!build) {
      throw new NotFoundException(`Build not found: ${id}`);
    }

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

    // left unset when the upsert fails with anything but P2002, and then reading it throws
    let build!: Build;
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
