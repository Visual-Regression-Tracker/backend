import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NoiseSummaryDto } from './dto/noise-summary.dto';

const HISTORY_BUILDS = 20;
const MIN_HISTORY_BUILDS = 5;

const verdictIs = (verdict: string): Prisma.TestRunWhereInput => ({
  noiseAnalysis: { path: ['verdict'], equals: verdict },
});
const ANALYSED: Prisma.TestRunWhereInput = { OR: [verdictIs('noise'), verdictIs('change')] };
const NOISE_LIKE = verdictIs('noise');

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

@Injectable()
export class NoiseSummaryService {
  constructor(private prismaService: PrismaService) {}

  async forBuild(buildId: string): Promise<NoiseSummaryDto> {
    const build = await this.prismaService.build.findUnique({ where: { id: buildId }, select: { projectId: true } });
    if (!build) {
      throw new NotFoundException(`Build not found: ${buildId}`);
    }

    const unresolvedRuns: Prisma.TestRunWhereInput = { buildId, status: TestStatus.unresolved };
    const byEnvironmentQuery = (extra: Prisma.TestRunWhereInput) =>
      this.prismaService.testRun.groupBy({
        by: ['browser', 'os', 'device'],
        where: { ...unresolvedRuns, ...extra },
        _count: { _all: true },
      });

    const [unresolvedGroups, noiseGroups, analysed, projectTypical] = await Promise.all([
      byEnvironmentQuery({}),
      byEnvironmentQuery(NOISE_LIKE),
      this.prismaService.testRun.count({ where: { ...unresolvedRuns, ...ANALYSED } }),
      this.projectTypical(build.projectId),
    ]);

    const environmentKey = (group: { browser: string | null; os: string | null; device: string | null }) =>
      JSON.stringify([group.browser, group.os, group.device]);
    const noiseByEnvironment = new Map(noiseGroups.map((group) => [environmentKey(group), group._count._all]));

    const byEnvironment = unresolvedGroups.map(({ browser, os, device, _count }) => ({
      browser,
      os,
      device,
      unresolved: _count._all,
      noiseLike: noiseByEnvironment.get(environmentKey({ browser, os, device })) ?? 0,
    }));

    return {
      unresolved: byEnvironment.reduce((sum, group) => sum + group.unresolved, 0),
      analysed,
      noiseLike: byEnvironment.reduce((sum, group) => sum + group.noiseLike, 0),
      byEnvironment,
      ...(projectTypical !== undefined && { projectTypical }),
    };
  }

  private async projectTypical(projectId: string): Promise<number | undefined> {
    const builds = await this.prismaService.build.findMany({
      where: { projectId, testRuns: { some: { status: TestStatus.unresolved, ...ANALYSED } } },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_BUILDS,
      select: { id: true },
    });
    if (builds.length < MIN_HISTORY_BUILDS) {
      return undefined;
    }

    const where: Prisma.TestRunWhereInput = {
      buildId: { in: builds.map((build) => build.id) },
      status: TestStatus.unresolved,
    };
    const [analysedGroups, noiseGroups] = await Promise.all([
      this.prismaService.testRun.groupBy({ by: ['buildId'], where: { ...where, ...ANALYSED }, _count: { _all: true } }),
      this.prismaService.testRun.groupBy({
        by: ['buildId'],
        where: { ...where, ...NOISE_LIKE },
        _count: { _all: true },
      }),
    ]);
    const noiseByBuild = new Map(noiseGroups.map((group) => [group.buildId, group._count._all]));

    return median(analysedGroups.map((group) => (noiseByBuild.get(group.buildId) ?? 0) / group._count._all));
  }
}
