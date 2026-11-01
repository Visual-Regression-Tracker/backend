import { TestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getBuildsStats } from './build-stats';

const prismaWith = (groupByMock: jest.Mock) => ({ testRun: { groupBy: groupByMock } }) as unknown as PrismaService;

describe('getBuildsStats', () => {
  it('returns an empty map without querying when no build ids are given', async () => {
    const groupByMock = jest.fn();

    const stats = await getBuildsStats(prismaWith(groupByMock), []);

    expect(stats.size).toBe(0);
    expect(groupByMock).not.toHaveBeenCalled();
  });

  it('groups test runs by build, status and merge flag in one query', async () => {
    const groupByMock = jest.fn().mockResolvedValue([]);

    await getBuildsStats(prismaWith(groupByMock), ['b1', 'b2']);

    expect(groupByMock).toHaveBeenCalledTimes(1);
    expect(groupByMock).toHaveBeenCalledWith({
      by: ['buildId', 'status', 'merge'],
      where: { buildId: { in: ['b1', 'b2'] } },
      _count: { _all: true },
    });
  });

  it('sums the status counts into passed, unresolved and failed per build', async () => {
    const groupByMock = jest.fn().mockResolvedValueOnce([
      { buildId: 'b1', status: TestStatus.ok, merge: false, _count: { _all: 1 } },
      { buildId: 'b1', status: TestStatus.ok, merge: true, _count: { _all: 2 } },
      { buildId: 'b1', status: TestStatus.approved, merge: false, _count: { _all: 2 } },
      { buildId: 'b1', status: TestStatus.autoApproved, merge: false, _count: { _all: 4 } },
      { buildId: 'b1', status: TestStatus.new, merge: false, _count: { _all: 8 } },
      { buildId: 'b1', status: TestStatus.unresolved, merge: false, _count: { _all: 16 } },
      { buildId: 'b1', status: TestStatus.failed, merge: false, _count: { _all: 32 } },
      { buildId: 'b2', status: TestStatus.failed, merge: true, _count: { _all: 3 } },
      { buildId: 'b2', status: 'resolved' as TestStatus, merge: false, _count: { _all: 100 } },
    ]);

    const stats = await getBuildsStats(prismaWith(groupByMock), ['b1', 'b2', 'b3']);

    expect([...stats.entries()]).toEqual([
      ['b1', { passedCount: 9, unresolvedCount: 24, failedCount: 32, merge: true }],
      ['b2', { passedCount: 0, unresolvedCount: 0, failedCount: 3, merge: true }],
      ['b3', { passedCount: 0, unresolvedCount: 0, failedCount: 0, merge: false }],
    ]);
  });

  it('keeps one entry per id when the same build id is asked for twice', async () => {
    const groupByMock = jest
      .fn()
      .mockResolvedValueOnce([{ buildId: 'b1', status: TestStatus.ok, merge: false, _count: { _all: 2 } }]);

    const stats = await getBuildsStats(prismaWith(groupByMock), ['b1', 'b1']);

    expect([...stats.entries()]).toEqual([
      ['b1', { passedCount: 2, unresolvedCount: 0, failedCount: 0, merge: false }],
    ]);
  });
});
