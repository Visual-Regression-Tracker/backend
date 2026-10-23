import { TestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface BuildStats {
  passedCount: number;
  unresolvedCount: number;
  failedCount: number;
  merge: boolean;
}

const PASSED_STATUSES: TestStatus[] = [TestStatus.ok, TestStatus.approved, TestStatus.autoApproved];
const UNRESOLVED_STATUSES: TestStatus[] = [TestStatus.unresolved, TestStatus.new];

/**
 * Aggregates test-run statistics per build inside the database instead of
 * loading every test-run row into the API process: builds can hold thousands
 * of runs and these stats are recomputed on every build_updated event burst
 * during ingestion.
 */
export async function getBuildsStats(prisma: PrismaService, buildIds: string[]): Promise<Map<string, BuildStats>> {
  const stats = new Map<string, BuildStats>(
    buildIds.map((id) => [id, { passedCount: 0, unresolvedCount: 0, failedCount: 0, merge: false }])
  );
  if (buildIds.length === 0) {
    return stats;
  }

  const [statusCounts, mergeBuilds] = await Promise.all([
    prisma.testRun.groupBy({
      by: ['buildId', 'status'],
      where: { buildId: { in: buildIds } },
      _count: { _all: true },
    }),
    prisma.testRun.groupBy({
      by: ['buildId'],
      where: { buildId: { in: buildIds }, merge: true },
    }),
  ]);

  for (const row of statusCounts) {
    const buildStats = stats.get(row.buildId);
    const count = row._count._all;
    if (PASSED_STATUSES.includes(row.status)) {
      buildStats.passedCount += count;
    } else if (UNRESOLVED_STATUSES.includes(row.status)) {
      buildStats.unresolvedCount += count;
    } else if (row.status === TestStatus.failed) {
      buildStats.failedCount += count;
    }
  }
  for (const row of mergeBuilds) {
    stats.get(row.buildId).merge = true;
  }
  return stats;
}
