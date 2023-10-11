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
    this.logger.debug(`Going to remove Build ${id}`);

    const build = await this.prismaService.build.findUnique({
      where: { id },
      include: {
        testRuns: true,
      },
    });

    await Promise.all(build.testRuns.map((testRun) => this.testRunsService.delete(testRun.id)));

    const promise = this.prismaService.build
      .delete({
        where: { id },
      })
      .then((build) => {
        this.logger.log('Deleted build:' + JSON.stringify(build.id));
        this.eventsGateway.buildDeleted(
          new BuildDto({
            ...build,
          })
        );
        return build;
      });
    return promise;
  }

  async deleteOldBuilds(projectId: string, keepBuilds: number) {
    keepBuilds = keepBuilds < 2 ? keepBuilds : keepBuilds - 1;
    this.findMany(projectId, undefined, keepBuilds).then((buildList) => {
      buildList.data.forEach((eachBuild) => {
        this.remove(eachBuild.id);
      });
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
