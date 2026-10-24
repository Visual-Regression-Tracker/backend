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

  it('groups test runs by build and status, and by build for merge runs', async () => {
    const groupByMock = jest.fn().mockResolvedValue([]);

    await getBuildsStats(prismaWith(groupByMock), ['b1', 'b2']);

    expect(groupByMock).toHaveBeenNthCalledWith(1, {
      by: ['buildId', 'status'],
      where: { buildId: { in: ['b1', 'b2'] } },
      _count: { _all: true },
    });
    expect(groupByMock).toHaveBeenNthCalledWith(2, {
      by: ['buildId'],
      where: { buildId: { in: ['b1', 'b2'] }, merge: true },
    });
  });

  it('sums the status counts into passed, unresolved and failed per build', async () => {
    const groupByMock = jest
      .fn()
      .mockResolvedValueOnce([
        { buildId: 'b1', status: TestStatus.ok, _count: { _all: 1 } },
        { buildId: 'b1', status: TestStatus.approved, _count: { _all: 2 } },
        { buildId: 'b1', status: TestStatus.autoApproved, _count: { _all: 4 } },
        { buildId: 'b1', status: TestStatus.new, _count: { _all: 8 } },
        { buildId: 'b1', status: TestStatus.unresolved, _count: { _all: 16 } },
        { buildId: 'b1', status: TestStatus.failed, _count: { _all: 32 } },
        { buildId: 'b2', status: TestStatus.failed, _count: { _all: 3 } },
        // a status outside the known groups is not counted anywhere
        { buildId: 'b2', status: 'resolved' as TestStatus, _count: { _all: 100 } },
      ])
      .mockResolvedValueOnce([{ buildId: 'b2' }]);

    const stats = await getBuildsStats(prismaWith(groupByMock), ['b1', 'b2', 'b3']);

    expect([...stats.entries()]).toEqual([
      ['b1', { passedCount: 7, unresolvedCount: 24, failedCount: 32, merge: false }],
      ['b2', { passedCount: 0, unresolvedCount: 0, failedCount: 3, merge: true }],
      ['b3', { passedCount: 0, unresolvedCount: 0, failedCount: 0, merge: false }],
    ]);
  });

  it('keeps one entry per id when the same build id is asked for twice', async () => {
    const groupByMock = jest
      .fn()
      .mockResolvedValueOnce([{ buildId: 'b1', status: TestStatus.ok, _count: { _all: 2 } }])
      .mockResolvedValueOnce([]);

    const stats = await getBuildsStats(prismaWith(groupByMock), ['b1', 'b1']);

    expect([...stats.entries()]).toEqual([
      ['b1', { passedCount: 2, unresolvedCount: 0, failedCount: 0, merge: false }],
    ]);
  });
});
