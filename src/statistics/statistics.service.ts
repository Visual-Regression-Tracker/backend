import { Injectable } from '@nestjs/common';
import { TestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BuildResultDto } from './dto/build-result.dto';

const emptyCounts = (): Record<TestStatus, number> =>
  Object.fromEntries(Object.values(TestStatus).map((status) => [status, 0])) as Record<TestStatus, number>;

@Injectable()
export class StatisticsService {
  constructor(private prismaService: PrismaService) {}

  async getResults(projectId: string, branchName?: string): Promise<BuildResultDto[]> {
    const buildWhere = { projectId, ...(branchName !== undefined && { branchName }) };
    const [builds, groups] = await Promise.all([
      this.prismaService.build.findMany({
        where: buildWhere,
        select: { id: true, number: true, ciBuildId: true, branchName: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prismaService.testRun.groupBy({
        by: ['buildId', 'status'],
        where: { build: buildWhere },
        _count: { _all: true },
      }),
    ]);

    const countsByBuild = new Map<string, Record<TestStatus, number>>();
    for (const { buildId, status, _count } of groups) {
      const counts = countsByBuild.get(buildId) ?? emptyCounts();
      counts[status] = _count._all;
      countsByBuild.set(buildId, counts);
    }

    return builds.map((build) => ({ ...build, counts: countsByBuild.get(build.id) ?? emptyCounts() }));
  }
}
