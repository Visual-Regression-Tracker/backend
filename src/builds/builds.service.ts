import {
  BeforeApplicationShutdown,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isPrismaError } from '../prisma/prisma-errors';
import { Build, Prisma, TestRun, TestStatus } from '@prisma/client';
import { TestRunsService } from '../test-runs/test-runs.service';
import { EventsGateway } from '../shared/events/events.gateway';
import { BuildDto } from './dto/build.dto';
import { getBuildsStats } from './build-stats';
import { testRunImageNames } from '../utils';
import { PaginatedBuildDto } from './dto/build-paginated.dto';
import { ModifyBuildDto } from './dto/build-modify.dto';
import type { WrapperType } from '../shared/wrapper-type';
import { StaticService } from '../static/static.service';

const TEST_RUN_CHUNK = 500;
const MAX_REMOVE_ATTEMPTS = 3;
const BUILD_ORDER: Prisma.BuildOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'desc' }];

const RETENTION_GRACE_MS = 60 * 60_000;

class BuildAlreadyNumbered extends Error {}

@Injectable()
export class BuildsService implements BeforeApplicationShutdown {
  private readonly logger: Logger = new Logger(BuildsService.name);
  private readonly ongoingDeletions = new Map<string, Promise<void>>();
  private shuttingDown = false;

  constructor(
    private prismaService: PrismaService,
    private eventsGateway: EventsGateway,
    @Inject(forwardRef(() => TestRunsService))
    private testRunsService: WrapperType<TestRunsService>,
    private staticService: StaticService
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
    take: number,
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

    const pageSkip = aroundBuildId ? ((await this.skipToPageWith(where, take, aroundBuildId)) ?? skip) : skip;

    const [total, buildList] = await Promise.all([
      this.prismaService.build.count({ where }),
      this.prismaService.build.findMany({
        where,
        take,
        skip: pageSkip,
        orderBy: BUILD_ORDER,
      }),
    ]);

    const stats = await getBuildsStats(
      this.prismaService,
      buildList.map((build) => build.id)
    );
    return {
      data: buildList.map((build) => new BuildDto(build, stats.get(build.id))),
      total,
      take,
      skip: pageSkip,
    };
  }

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
      data: { ciBuildId: modifyBuildDto.ciBuildId, isRunning: modifyBuildDto.isRunning },
    });
    this.eventsGateway.buildUpdated(id);
    return this.findOne(id);
  }

  async remove(
    id: string,
    { onlyIfIdleSince }: { onlyIfIdleSince?: Date } = {}
  ): Promise<(Build & { testRuns: TestRun[] }) | undefined> {
    if (!id) {
      this.logger.warn(`Attempted to remove build with undefined ID.`);
      return;
    }
    this.logger.debug(`Going to remove Build ${id}`);

    const build = await this.prismaService.build.findUnique({ where: { id } });
    if (!build) {
      this.logger.warn(`Build not found ${id}`);
      return;
    }

    const testRuns: TestRun[] = [];
    for (let attempt = 1; ; attempt++) {
      const removedRuns = await this.removeTestRuns(id, onlyIfIdleSince);
      if (!removedRuns || (onlyIfIdleSince && !(await this.isIdle(id, onlyIfIdleSince)))) {
        this.logger.log(`Keeping build ${id}: it is in use`);
        return;
      }
      testRuns.push(...removedRuns);
      try {
        await this.prismaService.build.delete({ where: { id } });
        break;
      } catch (e) {
        // workaround https://github.com/Visual-Regression-Tracker/Visual-Regression-Tracker/issues/435
        if (isPrismaError(e, 'P2025')) {
          this.logger.warn(`Build already deleted ${id}`);
          return;
        }
        if (!isPrismaError(e, 'P2003')) {
          throw e;
        }
        if (onlyIfIdleSince) {
          this.logger.log(`Keeping build ${id}: it received new test runs`);
          return;
        }
        if (attempt === MAX_REMOVE_ATTEMPTS) {
          throw new ConflictException(`Build ${id} keeps receiving test runs, try again later`);
        }
      }
    }

    this.logger.log(`Build deleted ${id}`);
    const removed = { ...build, testRuns };
    this.eventsGateway.buildDeleted(new BuildDto(removed));
    return removed;
  }

  private async isIdle(buildId: string, since: Date): Promise<boolean> {
    const idle = await this.prismaService.build.findFirst({
      where: { id: buildId, updatedAt: { lt: since }, testRuns: { none: { createdAt: { gte: since } } } },
      select: { id: true },
    });
    return idle !== null;
  }

  // rows before files: a failure leaks bytes instead of leaving runs that point at deleted images
  private async removeTestRuns(buildId: string, onlyIfIdleSince?: Date): Promise<TestRun[] | null> {
    const removed: TestRun[] = [];
    for (;;) {
      if (onlyIfIdleSince && !(await this.isIdle(buildId, onlyIfIdleSince))) {
        return null;
      }
      const chunk = await this.prismaService.testRun.findMany({ where: { buildId }, take: TEST_RUN_CHUNK });
      if (chunk.length === 0) {
        return removed;
      }
      await this.prismaService.testRun.deleteMany({ where: { id: { in: chunk.map((testRun) => testRun.id) } } });
      await this.staticService.deleteImages(chunk.flatMap(testRunImageNames));
      chunk.forEach((testRun) => this.eventsGateway.testRunDeleted(testRun));
      removed.push(...chunk);
    }
  }

  async deleteOldBuilds(projectId: string, keepBuilds: number, keepBuildId: string): Promise<void> {
    const key = `${projectId}|${keepBuildId}`;
    const ongoing = this.ongoingDeletions.get(key);
    if (ongoing) {
      this.logger.debug(`Deletion for ${key} is already in progress. Returning existing promise.`);
      return ongoing;
    }

    const deletionPromise = (async () => {
      this.logger.debug(`Starting to delete old builds for project ${projectId}, keeping ${keepBuilds} builds.`);
      const onlyIfIdleSince = new Date(Date.now() - RETENTION_GRACE_MS);
      const oldBuilds = await this.prismaService.build.findMany({
        where: { projectId, id: { not: keepBuildId } },
        orderBy: BUILD_ORDER,
        skip: Math.max(keepBuilds - 1, 0),
        select: { id: true },
      });
      for (const { id } of oldBuilds) {
        if (this.shuttingDown) {
          break;
        }
        try {
          await this.remove(id, { onlyIfIdleSince });
        } catch (e) {
          this.logger.warn(`Cannot remove old build ${id}: ${e}`);
        }
      }
      this.logger.debug(`Finished deleting old builds for project ${projectId}.`);
    })();

    this.ongoingDeletions.set(key, deletionPromise);

    deletionPromise
      .finally(() => {
        this.ongoingDeletions.delete(key);
        this.logger.debug(`Deletion promise for ${key} resolved/rejected and removed from map.`);
      })
      // finally() would pass the rejection to a promise nobody awaits and crash the process
      .catch((): void => undefined);

    return deletionPromise;
  }

  scheduleRetention(projectId: string, keepBuilds: number, keepBuildId: string): void {
    this.deleteOldBuilds(projectId, keepBuilds, keepBuildId).catch((e) =>
      this.logger.warn(`Cannot remove old builds of project ${projectId}: ${e}`)
    );
  }

  async whenRetentionIdle(): Promise<void> {
    await Promise.allSettled([...this.ongoingDeletions.values()]);
  }

  // Runs before Prisma disconnects in onApplicationShutdown
  async beforeApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    await this.whenRetentionIdle();
  }

  async approve(id: string, merge: boolean, userId?: string): Promise<void> {
    const build = await this.prismaService.build.findUnique({
      where: { id },
      include: {
        testRuns: {
          where: {
            status: {
              in: [TestStatus.new, TestStatus.unresolved],
            },
          },
          select: { id: true },
        },
      },
    });

    if (!build) {
      throw new NotFoundException(`Build not found: ${id}`);
    }

    for (const testRun of build.testRuns) {
      await this.testRunsService.approve(testRun.id, merge, false, userId);
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
      if (!isPrismaError(e, 'P2002')) {
        throw e;
      }
      // concurrent upsert workaround https://www.prisma.io/docs/reference/api-reference/prisma-client-reference#unique-key-constraint-errors-on-upserts
      build = await this.prismaService.build.update({
        where,
        data: {
          isRunning: true,
        },
      });
    }

    if (build.number === null) {
      const numbered = await this.assignNumber(build.id, projectId);
      if (numbered) {
        this.eventsGateway.buildCreated(new BuildDto(numbered));
        return numbered;
      }
      return this.prismaService.build.findUniqueOrThrow({ where: { id: build.id } });
    }

    return build;
  }

  private async assignNumber(buildId: string, projectId: string): Promise<Build | null> {
    try {
      return await this.prismaService.$transaction(async (tx) => {
        const { buildsCounter } = await tx.project.update({
          where: { id: projectId },
          data: { buildsCounter: { increment: 1 } },
          select: { buildsCounter: true },
        });
        const [numbered] = await tx.build.updateManyAndReturn({
          where: { id: buildId, number: null },
          data: { number: buildsCounter },
        });
        if (!numbered) {
          throw new BuildAlreadyNumbered();
        }
        return numbered;
      });
    } catch (e) {
      if (e instanceof BuildAlreadyNumbered) {
        return null;
      }
      throw e;
    }
  }
}
