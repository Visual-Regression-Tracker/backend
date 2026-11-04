import { NotFoundException } from '@nestjs/common';
import { TestStatus } from '@prisma/client';
import { NoiseSummaryService } from './noise-summary.service';
import { PrismaService } from '../prisma/prisma.service';

const verdictIs = (verdict: string) => ({ noiseAnalysis: { path: ['verdict'], equals: verdict } });
const analysed = { OR: [verdictIs('noise'), verdictIs('change')] };

const setup = () => {
  const prisma = {
    build: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    testRun: { count: jest.fn().mockResolvedValue(0), groupBy: jest.fn().mockResolvedValue([]) },
  };
  const service = new NoiseSummaryService(prisma as unknown as PrismaService);
  prisma.build.findUnique.mockResolvedValue({ id: 'b0', projectId: 'p1' });
  return { prisma, service };
};

type Setup = ReturnType<typeof setup>;

const env = (browser: string | null, os: string | null, device: string | null, count: number) => ({
  browser,
  os,
  device,
  _count: { _all: count },
});

const haveHistory = ({ prisma }: Setup, shares: [number, number][]) => {
  const ids = shares.map((_, i) => ({ id: `h${i}` }));
  prisma.build.findMany.mockResolvedValue(ids);
  prisma.testRun.groupBy.mockImplementation(async ({ by, where }) => {
    if (by[0] !== 'buildId') return [];
    const noise = JSON.stringify(where).includes('"noise"') && !JSON.stringify(where).includes('"change"');
    return shares.map(([analysedCount, noiseCount], i) => ({
      buildId: `h${i}`,
      _count: { _all: noise ? noiseCount : analysedCount },
    }));
  });
};

describe('NoiseSummaryService', () => {
  it('404s for a missing build', async () => {
    const { prisma, service } = setup();
    prisma.build.findUnique.mockResolvedValue(null);

    await expect(service.forBuild('nope')).rejects.toThrow(NotFoundException);
    expect(prisma.build.findUnique).toHaveBeenCalledWith({ where: { id: 'nope' }, select: { projectId: true } });
  });

  it('counts the build runs with database filters on the verdict path', async () => {
    const { prisma, service } = setup();
    prisma.testRun.count.mockResolvedValue(3);
    prisma.testRun.groupBy.mockImplementation(async ({ where }) =>
      where.noiseAnalysis
        ? [env('chrome', 'linux', null, 2)]
        : [env('chrome', 'linux', null, 4), env(null, null, null, 1)]
    );

    const summary = await service.forBuild('b0');

    expect(prisma.testRun.count).toHaveBeenCalledWith({
      where: { buildId: 'b0', status: TestStatus.unresolved, ...analysed },
    });
    expect(prisma.testRun.groupBy).toHaveBeenCalledWith({
      by: ['browser', 'os', 'device'],
      where: { buildId: 'b0', status: TestStatus.unresolved },
      _count: { _all: true },
    });
    expect(prisma.testRun.groupBy).toHaveBeenCalledWith({
      by: ['browser', 'os', 'device'],
      where: { buildId: 'b0', status: TestStatus.unresolved, ...verdictIs('noise') },
      _count: { _all: true },
    });
    expect(summary).toEqual({
      unresolved: 5,
      analysed: 3,
      noiseLike: 2,
      byEnvironment: [
        { browser: 'chrome', os: 'linux', device: null, unresolved: 4, noiseLike: 2 },
        { browser: null, os: null, device: null, unresolved: 1, noiseLike: 0 },
      ],
    });
  });

  it('reports an empty build as zeros without projectTypical when there is no history', async () => {
    const { service } = setup();

    expect(await service.forBuild('b0')).toEqual({ unresolved: 0, analysed: 0, noiseLike: 0, byEnvironment: [] });
  });

  it('picks the last 20 builds of the project that have an analysed unresolved run', async () => {
    const { prisma, service } = setup();

    await service.forBuild('b0');

    expect(prisma.build.findMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', testRuns: { some: { status: TestStatus.unresolved, ...analysed } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true },
    });
  });

  it('leaves projectTypical out for 4 builds', async () => {
    const setupResult = setup();
    haveHistory(setupResult, [
      [10, 1],
      [10, 1],
      [10, 1],
      [10, 1],
    ]);

    expect(await setupResult.service.forBuild('b0')).not.toHaveProperty('projectTypical');
  });

  it('reports the median share for 5 builds, counting only those builds', async () => {
    const setupResult = setup();
    haveHistory(setupResult, [
      [10, 9],
      [10, 1],
      [4, 1],
      [10, 5],
      [10, 0],
    ]);

    const summary = await setupResult.service.forBuild('b0');

    expect(summary.projectTypical).toBeCloseTo(0.25);
    expect(setupResult.prisma.testRun.groupBy).toHaveBeenCalledWith({
      by: ['buildId'],
      where: { buildId: { in: ['h0', 'h1', 'h2', 'h3', 'h4'] }, status: TestStatus.unresolved, ...analysed },
      _count: { _all: true },
    });
    expect(setupResult.prisma.testRun.groupBy).toHaveBeenCalledWith({
      by: ['buildId'],
      where: { buildId: { in: ['h0', 'h1', 'h2', 'h3', 'h4'] }, status: TestStatus.unresolved, ...verdictIs('noise') },
      _count: { _all: true },
    });
  });

  it('averages the two middle shares for an even number of builds', async () => {
    const setupResult = setup();
    haveHistory(setupResult, [
      [10, 0],
      [10, 2],
      [10, 4],
      [10, 6],
      [10, 8],
      [10, 10],
    ]);

    expect((await setupResult.service.forBuild('b0')).projectTypical).toBeCloseTo(0.5);
  });

  it('treats a build with no noise runs in the history as share 0', async () => {
    const setupResult = setup();
    const { prisma } = setupResult;
    prisma.build.findMany.mockResolvedValue([0, 1, 2, 3, 4].map((i) => ({ id: `h${i}` })));
    prisma.testRun.groupBy.mockImplementation(async ({ by, where }) => {
      if (by[0] !== 'buildId') return [];
      return JSON.stringify(where).includes('"noise"') && !JSON.stringify(where).includes('"change"')
        ? []
        : [0, 1, 2, 3, 4].map((i) => ({ buildId: `h${i}`, _count: { _all: 3 } }));
    });

    expect((await setupResult.service.forBuild('b0')).projectTypical).toBe(0);
  });
});
