import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { StatisticsService } from './statistics.service';

describe('StatisticsService', () => {
  let service: StatisticsService;
  const prismaService = {
    build: { findMany: jest.fn() },
    testRun: { groupBy: jest.fn() },
  };
  const zero = { failed: 0, new: 0, ok: 0, unresolved: 0, approved: 0, autoApproved: 0 };
  const build = (id: string, number: number) => ({
    id,
    number,
    ciBuildId: `ci-${id}`,
    branchName: 'master',
    createdAt: new Date(`2026-01-0${number}`),
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [StatisticsService, { provide: PrismaService, useValue: prismaService }],
    }).compile();
    service = module.get(StatisticsService);
  });

  it('counts runs per status for each build with one groupBy and one build query', async () => {
    prismaService.build.findMany.mockResolvedValue([build('a', 1), build('b', 2)]);
    prismaService.testRun.groupBy.mockResolvedValue([
      { buildId: 'a', status: 'ok', _count: { _all: 3 } },
      { buildId: 'a', status: 'failed', _count: { _all: 1 } },
      { buildId: 'b', status: 'autoApproved', _count: { _all: 2 } },
    ]);

    await expect(service.getResults('p1')).resolves.toEqual([
      { ...build('a', 1), counts: { ...zero, ok: 3, failed: 1 } },
      { ...build('b', 2), counts: { ...zero, autoApproved: 2 } },
    ]);
    expect(prismaService.build.findMany).toHaveBeenCalledTimes(1);
    expect(prismaService.testRun.groupBy).toHaveBeenCalledTimes(1);
    expect(prismaService.testRun.groupBy).toHaveBeenCalledWith({
      by: ['buildId', 'status'],
      where: { build: { projectId: 'p1' } },
      _count: { _all: true },
    });
  });

  it('returns zero counts for a build without runs', async () => {
    prismaService.build.findMany.mockResolvedValue([build('a', 1)]);
    prismaService.testRun.groupBy.mockResolvedValue([]);

    await expect(service.getResults('p1')).resolves.toEqual([{ ...build('a', 1), counts: zero }]);
  });

  it('limits builds and runs to the branch when one is given', async () => {
    prismaService.build.findMany.mockResolvedValue([]);
    prismaService.testRun.groupBy.mockResolvedValue([]);

    await expect(service.getResults('p1', 'dev')).resolves.toEqual([]);
    expect(prismaService.build.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'p1', branchName: 'dev' }, orderBy: { createdAt: 'asc' } })
    );
    expect(prismaService.testRun.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { build: { projectId: 'p1', branchName: 'dev' } } })
    );
  });
});
