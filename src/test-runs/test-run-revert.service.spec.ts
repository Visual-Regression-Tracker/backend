import { TestVariationsService } from '../test-variations/test-variations.service';
import { Test } from '@nestjs/testing';
import { Baseline, TestRun, TestStatus, TestVariation } from '@prisma/client';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { NO_TEST_VARIATION } from './test-runs.shared';
import { RevertDecision, TestRunRevertService } from './test-run-revert.service';
import { PrismaService } from '../prisma/prisma.service';
import { StaticService } from '../static/static.service';
import { EventsGateway } from '../shared/events/events.gateway';
import { getTestVariationUniqueData } from '../utils';
import { generateBaseline, generateTestRun, generateTestVariation } from '../_data_';

const createMocks = () => {
  const m = {
    testRun: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    testVariation: { count: jest.fn() },
    baseline: { count: jest.fn().mockResolvedValue(0) },
    static: { deleteImage: jest.fn() },
    events: { testRunUpdated: jest.fn() },
    tv: { findUnique: jest.fn() },
    tx: {} as object,
    transaction: jest.fn(),
  };
  m.transaction.mockImplementation((callback: (client: object) => unknown) => callback(m.tx));
  return m;
};

const build = async () => {
  const m = createMocks();
  const module = await Test.createTestingModule({
    providers: [
      TestRunRevertService,
      {
        provide: PrismaService,
        useValue: {
          $transaction: m.transaction,
          testRun: m.testRun,
          testVariation: m.testVariation,
          baseline: m.baseline,
        },
      },
      { provide: StaticService, useValue: m.static },
      { provide: EventsGateway, useValue: m.events },
      { provide: TestVariationsService, useValue: m.tv },
    ],
  }).compile();
  return { service: module.get<TestRunRevertService>(TestRunRevertService), m };
};

describe('TestRunRevertService', () => {
  const approvedRun = (overrides: Partial<TestRun> = {}) =>
    generateTestRun({
      id: 'run-1',
      status: TestStatus.approved,
      statusBeforeDecision: TestStatus.unresolved,
      branchName: 'master',
      baselineBranchName: 'master',
      projectId: 'project',
      ...overrides,
    });
  const variationOf = (overrides: Partial<TestVariation> = {}) =>
    generateTestVariation({ id: 'variation', projectId: 'project', baselineName: 'new.png', ...overrides }, []);
  const baselineOf = (overrides: Partial<Baseline> = {}) =>
    generateBaseline({
      id: 'baseline-1',
      testRunId: 'run-1',
      testVariationId: 'variation',
      baselineName: 'new.png',
      ...overrides,
    });
  const makeTx = () => ({
    testRun: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), count: jest.fn().mockResolvedValue(0) },
    baseline: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    testVariation: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn(), delete: jest.fn() },
  });
  const claim = (run: TestRun, data: object) => ({ where: { id: run.id, status: run.status }, data });
  const restored = (status: TestStatus, extra: object = {}) => ({ status, statusBeforeDecision: null, ...extra });

  const initRevertService = async (runs: TestRun[], counts: [number, number, number] = [0, 0, 0]) => {
    const ctx = await build();
    const { m } = ctx;
    const tx = makeTx();
    m.tx = tx;
    m.testRun.findMany.mockResolvedValue(runs);
    m.testRun.count.mockResolvedValue(counts[0]);
    m.testVariation.count.mockResolvedValue(counts[1]);
    m.baseline.count.mockResolvedValue(counts[2]);
    return { ...ctx, tx };
  };
  type RevertContext = Awaited<ReturnType<typeof initRevertService>>;

  const givenApproval = ({ tx }: RevertContext, previousName: string | null = 'old.png', branchName = 'master') => {
    tx.baseline.findUnique.mockResolvedValue(baselineOf());
    tx.baseline.findFirst
      .mockResolvedValueOnce(baselineOf())
      .mockResolvedValueOnce(previousName && baselineOf({ id: 'baseline-0', baselineName: previousName }));
    tx.testVariation.findUnique.mockResolvedValue(variationOf({ branchName }));
  };

  it('reverts a rejected run to the status it was decided from', async () => {
    const run = generateTestRun({ status: TestStatus.failed, statusBeforeDecision: TestStatus.ok });
    const { service, tx } = await initRevertService([run]);

    await service.revert([run.id], RevertDecision.reject);

    expect(tx.testRun.updateMany).toHaveBeenCalledWith(claim(run, restored(TestStatus.ok)));
    expect(tx.baseline.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['has a baseline', 'baseline.png', TestStatus.unresolved],
    ['has none', null, TestStatus.new],
  ])(
    'a rejected run without a recorded status falls back by its baseline: run that %s',
    async (_title, baselineName, expected) => {
      const run = generateTestRun({ status: TestStatus.failed, statusBeforeDecision: null, baselineName });
      const { service, tx } = await initRevertService([run]);

      await service.revert([run.id], RevertDecision.reject);

      expect(tx.testRun.updateMany).toHaveBeenCalledWith(claim(run, restored(expected)));
    }
  );

  it('reverts a same-branch approval: deletes the baseline row, restores the previous baselineName and the status', async () => {
    const run = approvedRun();
    const ctx = await initRevertService([run]);
    const { service, m, tx } = ctx;
    givenApproval(ctx);

    await service.revert([run.id], RevertDecision.approve);

    expect(tx.baseline.findUnique).toHaveBeenCalledWith({ where: { testRunId: run.id } });
    expect(tx.baseline.findFirst).toHaveBeenNthCalledWith(1, {
      where: { testVariationId: 'variation' },
      orderBy: { createdAt: 'desc' },
    });
    expect(tx.baseline.delete).toHaveBeenCalledWith({ where: { id: 'baseline-1' } });
    expect(tx.testVariation.update).toHaveBeenCalledWith({
      where: { id: 'variation' },
      data: { baselineName: 'old.png' },
    });
    expect(tx.testRun.updateMany).toHaveBeenCalledWith(claim(run, restored(TestStatus.unresolved)));
    expect(m.tv.findUnique).not.toHaveBeenCalled();
  });

  it('reverting the first approval of a screen leaves the variation without a baseline', async () => {
    const run = approvedRun();
    const ctx = await initRevertService([run]);
    givenApproval(ctx, null);

    await ctx.service.revert([run.id], RevertDecision.approve);

    expect(ctx.tx.testVariation.update).toHaveBeenCalledWith({
      where: { id: 'variation' },
      data: { baselineName: null },
    });
  });

  it('reverts a merge approval into the main variation without moving the run', async () => {
    const run = approvedRun({ branchName: 'feature', baselineBranchName: 'master', merge: true });
    const ctx = await initRevertService([run]);
    const { tx } = ctx;
    givenApproval(ctx, null);

    await ctx.service.revert([run.id], RevertDecision.approve);

    expect(tx.testVariation.update).toHaveBeenCalledWith({
      where: { id: 'variation' },
      data: { baselineName: null },
    });
    expect(tx.testRun.updateMany).toHaveBeenCalledWith(claim(run, restored(TestStatus.unresolved)));
    expect(tx.testVariation.delete).not.toHaveBeenCalled();
  });

  describe('of a feature-branch approval', () => {
    const featureRun = () => approvedRun({ branchName: 'feature', baselineBranchName: 'master' });
    const mainVariation = generateTestVariation({ id: 'main variation', branchName: 'master' }, []);

    const givenFeatureApproval = (ctx: RevertContext, previousName: string | null = null) => {
      givenApproval(ctx, previousName, 'feature');
      ctx.m.tv.findUnique.mockResolvedValue(mainVariation);
    };

    it('moves the run back to the main variation and deletes the feature variation it created', async () => {
      const run = featureRun();
      const ctx = await initRevertService([run]);
      const { service, m, tx } = ctx;
      givenFeatureApproval(ctx);

      await service.revert([run.id], RevertDecision.approve);

      expect(m.tv.findUnique).toHaveBeenCalledWith(
        { projectId: 'project', branchName: 'master', ...getTestVariationUniqueData(run) },
        tx
      );
      expect(tx.testRun.updateMany).toHaveBeenCalledWith(
        claim(run, restored(TestStatus.unresolved, { testVariationId: 'main variation' }))
      );
      expect(tx.testRun.count).toHaveBeenCalledWith({ where: { testVariationId: 'variation' } });
      expect(tx.baseline.count).toHaveBeenCalledWith({ where: { testVariationId: 'variation' } });
      expect(tx.testVariation.delete).toHaveBeenCalledWith({ where: { id: 'variation' } });
      expect(tx.testVariation.update).not.toHaveBeenCalled();
    });

    it.each([
      ['other runs', 1, 0],
      ['other baselines', 0, 1],
    ])(
      'keeps the feature variation when it has %s, restoring its previous baselineName',
      async (_title, runCount, baselineCount) => {
        const run = featureRun();
        const ctx = await initRevertService([run]);
        const { tx } = ctx;
        givenFeatureApproval(ctx, 'old.png');
        tx.testRun.count.mockResolvedValue(runCount);
        tx.baseline.count.mockResolvedValue(baselineCount);

        await ctx.service.revert([run.id], RevertDecision.approve);

        expect(tx.testVariation.delete).not.toHaveBeenCalled();
        expect(tx.testVariation.update).toHaveBeenCalledWith({
          where: { id: 'variation' },
          data: { baselineName: 'old.png' },
        });
      }
    );

    it('restores the ignore areas and comment the kept feature variation had before the approval', async () => {
      const run = featureRun();
      const ctx = await initRevertService([run]);
      const { tx } = ctx;
      givenFeatureApproval(ctx, 'old.png');
      tx.baseline.findUnique.mockResolvedValue(
        baselineOf({ ignoreAreasBeforeApproval: '[{"x":1}]', commentBeforeApproval: null })
      );
      tx.baseline.count.mockResolvedValue(1);

      await ctx.service.revert([run.id], RevertDecision.approve);

      expect(tx.testVariation.update).toHaveBeenCalledWith({
        where: { id: 'variation' },
        data: { baselineName: 'old.png', ignoreAreas: '[{"x":1}]', comment: null },
      });
    });

    it('409 when the main variation was deleted', async () => {
      const run = featureRun();
      const ctx = await initRevertService([run]);
      const { service, m, tx } = ctx;
      givenFeatureApproval(ctx);
      m.tv.findUnique.mockResolvedValue(null);

      await expect(service.revert([run.id], RevertDecision.approve)).rejects.toThrow(
        new ConflictException(NO_TEST_VARIATION)
      );

      expect(tx.testRun.updateMany).not.toHaveBeenCalled();
      expect(m.static.deleteImage).not.toHaveBeenCalled();
      expect(m.events.testRunUpdated).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['a later baseline exists', () => baselineOf({ id: 'baseline-2' }), 'new.png'],
    ['the variation points at another file', () => baselineOf(), 'other.png'],
  ])('409 when a later approval moved the baseline on: %s', async (_title, latest, variationBaselineName) => {
    const run = approvedRun();
    const { service, m, tx } = await initRevertService([run]);
    tx.baseline.findUnique.mockResolvedValue(baselineOf());
    tx.baseline.findFirst.mockResolvedValue(latest());
    tx.testVariation.findUnique.mockResolvedValue(variationOf({ baselineName: variationBaselineName }));

    await expect(service.revert([run.id], RevertDecision.approve)).rejects.toThrow(
      new ConflictException(`Test run ${run.id}: a later approval changed this baseline`)
    );

    expect(tx.baseline.delete).not.toHaveBeenCalled();
    expect(tx.testVariation.update).not.toHaveBeenCalled();
    expect(tx.testRun.updateMany).not.toHaveBeenCalled();
    expect(m.static.deleteImage).not.toHaveBeenCalled();
    expect(m.events.testRunUpdated).not.toHaveBeenCalled();
  });

  it.each([
    [RevertDecision.approve, TestStatus.failed, TestStatus.approved],
    [RevertDecision.reject, TestStatus.approved, TestStatus.failed],
    [RevertDecision.approve, TestStatus.autoApproved, TestStatus.approved],
    [RevertDecision.reject, TestStatus.unresolved, TestStatus.failed],
    [RevertDecision.approve, TestStatus.new, TestStatus.approved],
    [RevertDecision.reject, TestStatus.ok, TestStatus.failed],
  ])('409 when undoing %s of a %s run, before any write', async (decision, status, expected) => {
    const run = generateTestRun({ status });
    const { service, m, tx } = await initRevertService([run]);

    await expect(service.revert([run.id], decision)).rejects.toThrow(
      new ConflictException(`Test run ${run.id} is ${status}, not ${expected}`)
    );

    expect(m.transaction).not.toHaveBeenCalled();
    expect(tx.testRun.updateMany).not.toHaveBeenCalled();
    expect(m.events.testRunUpdated).not.toHaveBeenCalled();
  });

  describe('without a decision, as older clients send it', () => {
    it('reverts approved and rejected runs together, approvals latest first', async () => {
      const rejected = generateTestRun({ id: 'run-2', status: TestStatus.failed });
      const approved = approvedRun();
      const ctx = await initRevertService([rejected, approved]);
      givenApproval(ctx);

      await ctx.service.revert([rejected.id, approved.id]);

      expect(ctx.tx.baseline.findMany).toHaveBeenCalledWith({
        where: { testRunId: { in: [approved.id] } },
        select: { testRunId: true, createdAt: true },
      });
      expect(ctx.tx.baseline.delete).toHaveBeenCalledWith({ where: { id: 'baseline-1' } });
      expect(ctx.tx.testRun.updateMany).toHaveBeenCalledWith(claim(rejected, restored(TestStatus.new)));
    });

    it.each([TestStatus.autoApproved, TestStatus.new, TestStatus.unresolved, TestStatus.ok])(
      '409 for a %s run',
      async (status) => {
        const run = generateTestRun({ status });
        const { service, m } = await initRevertService([run]);

        await expect(service.revert([run.id])).rejects.toThrow(
          new ConflictException(`Test run ${run.id} is ${status}: only approved or rejected runs can be reverted`)
        );

        expect(m.transaction).not.toHaveBeenCalled();
      }
    );
  });

  it('409 when the approval has no baseline row', async () => {
    const run = approvedRun();
    const { service, tx } = await initRevertService([run]);

    await expect(service.revert([run.id], RevertDecision.approve)).rejects.toThrow(
      new ConflictException(`Test run ${run.id} has no baseline to revert`)
    );

    expect(tx.testRun.updateMany).not.toHaveBeenCalled();
  });

  it('409 for an empty list', async () => {
    const { service, m } = await initRevertService([]);

    await expect(service.revert([], RevertDecision.approve)).rejects.toThrow(
      new ConflictException('Nothing to revert')
    );

    expect(m.testRun.findMany).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('404 for an unknown id, and then no transaction runs', async () => {
    const run = generateTestRun({ status: TestStatus.failed });
    const { service, m } = await initRevertService([run]);

    await expect(service.revert([run.id, 'missing 1', 'missing 2'], RevertDecision.reject)).rejects.toThrow(
      new NotFoundException('Test run not found: missing 1, missing 2')
    );

    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('409 when the run changed status meanwhile', async () => {
    const run = generateTestRun({ status: TestStatus.failed });
    const { service, m, tx } = await initRevertService([run]);
    tx.testRun.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.revert([run.id], RevertDecision.reject)).rejects.toThrow(
      new ConflictException(`Test run ${run.id} changed while reverting, try again`)
    );

    expect(m.events.testRunUpdated).not.toHaveBeenCalled();
  });

  describe('the freed baseline file', () => {
    it.each([
      ['a run compared against it', [1, 0, 0]],
      ['a variation pointing at it', [0, 1, 0]],
      ['another baseline row', [0, 0, 1]],
    ] as [string, [number, number, number]][])('is kept while %s', async (_title, counts) => {
      const run = approvedRun();
      const ctx = await initRevertService([run], counts);
      givenApproval(ctx);

      await ctx.service.revert([run.id], RevertDecision.approve);

      expect(ctx.m.static.deleteImage).not.toHaveBeenCalled();
    });

    it('is deleted, after the commit, when nothing references it', async () => {
      const run = approvedRun({ name: 'screen' });
      const ctx = await initRevertService([run]);
      const { service, m } = ctx;
      givenApproval(ctx);

      await service.revert([run.id], RevertDecision.approve);

      expect(m.testRun.count).toHaveBeenCalledWith({ where: { name: 'screen', baselineName: 'new.png' } });
      expect(m.testVariation.count).toHaveBeenCalledWith({ where: { baselineName: 'new.png' } });
      expect(m.baseline.count).toHaveBeenCalledWith({ where: { baselineName: 'new.png' } });
      expect(m.static.deleteImage).toHaveBeenCalledTimes(1);
      expect(m.static.deleteImage).toHaveBeenCalledWith('new.png');
      expect(m.static.deleteImage.mock.invocationCallOrder[0]).toBeGreaterThan(
        m.transaction.mock.invocationCallOrder[0]
      );
    });

    it('is not touched when a rejection is reverted', async () => {
      const run = generateTestRun({ status: TestStatus.failed });
      const { service, m } = await initRevertService([run]);

      await service.revert([run.id], RevertDecision.reject);

      expect(m.static.deleteImage).not.toHaveBeenCalled();
    });
  });

  it('emits testRun_updated for every run after the commit, nothing on a 409', async () => {
    const second = generateTestRun({ id: 'run-2', status: TestStatus.failed });
    const first = generateTestRun({ id: 'run-1', status: TestStatus.failed });
    const { service, m } = await initRevertService([second, first]);
    m.testRun.findMany
      .mockResolvedValueOnce([second, first])
      .mockResolvedValueOnce([{ ...first, status: TestStatus.unresolved }, second]);

    await service.revert(['run-2', 'run-1', 'run-2'], RevertDecision.reject);

    expect(m.testRun.findMany).toHaveBeenLastCalledWith({ where: { id: { in: ['run-2', 'run-1'] } } });
    expect(m.testRun.findUnique).not.toHaveBeenCalled();
    expect(m.events.testRunUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'run-1', status: TestStatus.unresolved })
    );
    expect(m.events.testRunUpdated).toHaveBeenCalledTimes(2);
    expect(m.events.testRunUpdated).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'run-2' }));
    expect(m.events.testRunUpdated).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'run-1' }));
    expect(m.events.testRunUpdated.mock.invocationCallOrder[0]).toBeGreaterThan(
      m.transaction.mock.invocationCallOrder[0]
    );

    const failing = await initRevertService([generateTestRun({ status: TestStatus.new })]);
    await expect(
      failing.service.revert(['10fb5e02-64e0-4cf5-9f17-c00ab3c96658'], RevertDecision.approve)
    ).rejects.toThrow(ConflictException);
    expect(failing.m.events.testRunUpdated).not.toHaveBeenCalled();
  });

  it('reverts two approvals of one screen in one request, latest first', async () => {
    const older = approvedRun({ id: 'run-1' });
    const newer = approvedRun({ id: 'run-2' });
    const baselineOlder = baselineOf({ baselineName: 'first.png', createdAt: new Date(1000) });
    const baselineNewer = baselineOf({
      id: 'baseline-2',
      testRunId: 'run-2',
      baselineName: 'second.png',
      createdAt: new Date(2000),
    });
    const { service, m, tx } = await initRevertService([older, newer]);
    tx.baseline.findMany.mockResolvedValue([baselineOlder, baselineNewer]);
    tx.baseline.findUnique.mockImplementation(({ where }: { where: { testRunId: string } }) =>
      Promise.resolve(where.testRunId === 'run-1' ? baselineOlder : baselineNewer)
    );
    tx.baseline.findFirst
      .mockResolvedValueOnce(baselineNewer)
      .mockResolvedValueOnce(baselineOlder)
      .mockResolvedValueOnce(baselineOlder)
      .mockResolvedValueOnce(null);
    tx.testVariation.findUnique
      .mockResolvedValueOnce(variationOf({ baselineName: 'second.png' }))
      .mockResolvedValueOnce(variationOf({ baselineName: 'first.png' }));

    await service.revert(['run-1', 'run-2'], RevertDecision.approve);

    expect(tx.baseline.findMany).toHaveBeenCalledWith({
      where: { testRunId: { in: ['run-1', 'run-2'] } },
      select: { testRunId: true, createdAt: true },
    });
    expect(tx.baseline.delete.mock.calls).toEqual([
      [{ where: { id: 'baseline-2' } }],
      [{ where: { id: 'baseline-1' } }],
    ]);
    expect(tx.testVariation.update.mock.calls).toEqual([
      [{ where: { id: 'variation' }, data: { baselineName: 'first.png' } }],
      [{ where: { id: 'variation' }, data: { baselineName: null } }],
    ]);
    expect(m.static.deleteImage.mock.calls).toEqual([['second.png'], ['first.png']]);
  });
});
