import { TestRun, TestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface BuildStats {
  passedCount: number;
  unresolvedCount: number;
  failedCount: number;
  merge: boolean;
}

const PASSED_STATUSES: TestStatus[] = [TestStatus.ok, TestStatus.approved, TestStatus.autoApproved];
const UNRESOLVED_STATUSES: TestStatus[] = [TestStatus.unresolved, TestStatus.new];

const emptyStats = (): BuildStats => ({ passedCount: 0, unresolvedCount: 0, failedCount: 0, merge: false });

function addRuns(stats: BuildStats, status: TestStatus, merge: boolean, count: number): void {
  if (PASSED_STATUSES.includes(status)) {
    stats.passedCount += count;
  } else if (UNRESOLVED_STATUSES.includes(status)) {
    stats.unresolvedCount += count;
  } else if (status === TestStatus.failed) {
    stats.failedCount += count;
  }
  if (merge) {
    stats.merge = true;
  }
}

export function statsOf(runs: Pick<TestRun, 'status' | 'merge'>[]): BuildStats {
  const stats = emptyStats();
  for (const run of runs) {
    addRuns(stats, run.status, run.merge, 1);
  }
  return stats;
}

export async function getBuildsStats(prisma: PrismaService, buildIds: string[]): Promise<Map<string, BuildStats>> {
  const stats = new Map<string, BuildStats>(buildIds.map((id) => [id, emptyStats()]));
  if (buildIds.length === 0) {
    return stats;
  }

  const rows = await prisma.testRun.groupBy({
    by: ['buildId', 'status', 'merge'],
    where: { buildId: { in: buildIds } },
    _count: { _all: true },
  });

  for (const row of rows) {
    addRuns(stats.get(row.buildId)!, row.status, row.merge, row._count._all);
  }
  return stats;
}
