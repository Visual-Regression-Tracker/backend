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

export async function getBuildsStats(prisma: PrismaService, buildIds: string[]): Promise<Map<string, BuildStats>> {
  const stats = new Map<string, BuildStats>(
    buildIds.map((id) => [id, { passedCount: 0, unresolvedCount: 0, failedCount: 0, merge: false }])
  );
  if (buildIds.length === 0) {
    return stats;
  }

  const rows = await prisma.testRun.groupBy({
    by: ['buildId', 'status', 'merge'],
    where: { buildId: { in: buildIds } },
    _count: { _all: true },
  });

  for (const row of rows) {
    const buildStats = stats.get(row.buildId)!;
    const count = row._count._all;
    if (PASSED_STATUSES.includes(row.status)) {
      buildStats.passedCount += count;
    } else if (UNRESOLVED_STATUSES.includes(row.status)) {
      buildStats.unresolvedCount += count;
    } else if (row.status === TestStatus.failed) {
      buildStats.failedCount += count;
    }
    if (row.merge) {
      buildStats.merge = true;
    }
  }
  return stats;
}
