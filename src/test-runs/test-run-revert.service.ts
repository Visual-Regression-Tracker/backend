import { ConflictException, forwardRef, Inject, Injectable } from '@nestjs/common';
import { Prisma, TestRun, TestStatus } from '@prisma/client';
import { StaticService } from '../static/static.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../shared/events/events.gateway';
import { TestVariationsService } from '../test-variations/test-variations.service';
import { variationKey } from '../utils';
import type { WrapperType } from '../shared/wrapper-type';
import { NO_TEST_VARIATION, testRunNotFound } from './test-runs.shared';

export enum RevertDecision {
  approve = 'approve',
  reject = 'reject',
}

@Injectable()
export class TestRunRevertService {
  constructor(
    @Inject(forwardRef(() => TestVariationsService))
    private testVariationService: WrapperType<TestVariationsService>,
    private prismaService: PrismaService,
    private staticService: StaticService,
    private eventsGateway: EventsGateway
  ) {}

  async revert(ids: string[], decision?: RevertDecision): Promise<void> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) {
      throw new ConflictException('Nothing to revert');
    }
    const found = await this.prismaService.testRun.findMany({ where: { id: { in: uniqueIds } } });
    const byId = new Map(found.map((run) => [run.id, run]));
    const missing = uniqueIds.filter((id) => !byId.has(id));
    if (missing.length) {
      throw testRunNotFound(missing.join(', '));
    }
    const runs = uniqueIds.map((id) => byId.get(id)!);
    assertRevertable(runs, decision);

    const freedBaselines = await this.prismaService.$transaction(async (tx) => {
      const approved = runs.filter((run) => run.status === TestStatus.approved);
      for (const run of runs.filter((run) => run.status === TestStatus.failed)) {
        await this.restoreStatus(run, {}, tx);
      }
      const freed: { name: string; baselineName: string }[] = [];
      for (const run of await this.latestApprovalFirst(approved, tx)) {
        freed.push({ name: run.name, baselineName: await this.revertApproval(run, tx) });
      }
      return freed;
    });

    for (const { name, baselineName } of freedBaselines) {
      if (!(await this.isBaselineReferenced(name, baselineName))) {
        await this.staticService.deleteImage(baselineName);
      }
    }
    const reverted = await this.prismaService.testRun.findMany({ where: { id: { in: uniqueIds } } });
    const revertedById = new Map(reverted.map((run) => [run.id, run]));
    for (const id of uniqueIds) {
      this.eventsGateway.testRunUpdated(revertedById.get(id)!);
    }
  }

  private async latestApprovalFirst(runs: TestRun[], tx: Prisma.TransactionClient): Promise<TestRun[]> {
    const baselines = await tx.baseline.findMany({
      where: { testRunId: { in: runs.map((run) => run.id) } },
      select: { testRunId: true, createdAt: true },
    });
    const approvedAt = new Map(baselines.map((baseline) => [baseline.testRunId, baseline.createdAt.getTime()]));
    return [...runs].sort((a, b) => (approvedAt.get(b.id) ?? 0) - (approvedAt.get(a.id) ?? 0));
  }

  private async restoreStatus(
    run: TestRun,
    extra: { testVariationId?: string },
    tx: Prisma.TransactionClient
  ): Promise<void> {
    const { count } = await tx.testRun.updateMany({
      where: { id: run.id, status: run.status },
      data: {
        status: run.statusBeforeDecision ?? (run.baselineName ? TestStatus.unresolved : TestStatus.new),
        statusBeforeDecision: null,
        ...extra,
      },
    });
    if (count === 0) {
      throw new ConflictException(`Test run ${run.id} changed while reverting, try again`);
    }
  }

  private async revertApproval(run: TestRun, tx: Prisma.TransactionClient): Promise<string> {
    const baseline = await tx.baseline.findUnique({ where: { testRunId: run.id } });
    if (!baseline) {
      throw new ConflictException(`Test run ${run.id} has no baseline to revert`);
    }
    const latest = await latestBaseline(tx, baseline.testVariationId);
    const variation = await tx.testVariation.findUnique({ where: { id: baseline.testVariationId } });
    if (latest?.id !== baseline.id || variation?.baselineName !== baseline.baselineName) {
      throw new ConflictException(`Test run ${run.id}: a later approval changed this baseline`);
    }
    await tx.baseline.delete({ where: { id: baseline.id } });
    const previous = await latestBaseline(tx, variation.id);
    const restoreVariation = () =>
      tx.testVariation.update({
        where: { id: variation.id },
        data: {
          baselineName: previous?.baselineName ?? null,
          // null: the approval did not overwrite this variation's ignore areas and comment
          ...(baseline.ignoreAreasBeforeApproval !== null && {
            ignoreAreas: baseline.ignoreAreasBeforeApproval,
            comment: baseline.commentBeforeApproval,
          }),
        },
      });

    const wasFeatureBranchApproval =
      variation.branchName === run.branchName && run.baselineBranchName !== run.branchName;
    if (!wasFeatureBranchApproval) {
      await restoreVariation();
      await this.restoreStatus(run, {}, tx);
      return baseline.baselineName;
    }

    const mainVariation = await this.testVariationService.findUnique(
      variationKey(variation.projectId, run.baselineBranchName!, run),
      tx
    );
    if (!mainVariation) {
      throw new ConflictException(NO_TEST_VARIATION);
    }
    await this.restoreStatus(run, { testVariationId: mainVariation.id }, tx);
    const [baselines, testRuns] = await Promise.all([
      tx.baseline.count({ where: { testVariationId: variation.id } }),
      tx.testRun.count({ where: { testVariationId: variation.id } }),
    ]);
    if (baselines === 0 && testRuns === 0) {
      await tx.testVariation.delete({ where: { id: variation.id } });
    } else {
      await restoreVariation();
    }
    return baseline.baselineName;
  }

  private async isBaselineReferenced(name: string, baselineName: string): Promise<boolean> {
    const [runs, variations, baselines] = await Promise.all([
      this.prismaService.testRun.count({ where: { name, baselineName } }),
      this.prismaService.testVariation.count({ where: { baselineName } }),
      this.prismaService.baseline.count({ where: { baselineName } }),
    ]);
    return runs + variations + baselines > 0;
  }
}

const DECIDED_STATUS = { approve: TestStatus.approved, reject: TestStatus.failed } as const;

const assertRevertable = (runs: TestRun[], decision?: RevertDecision) => {
  if (decision) {
    const expected = DECIDED_STATUS[decision];
    const changed = runs.find((run) => run.status !== expected);
    if (changed) {
      throw new ConflictException(`Test run ${changed.id} is ${changed.status}, not ${expected}`);
    }
    return;
  }
  const undecided = runs.find((run) => run.status !== TestStatus.approved && run.status !== TestStatus.failed);
  if (undecided) {
    throw new ConflictException(
      `Test run ${undecided.id} is ${undecided.status}: only approved or rejected runs can be reverted`
    );
  }
};

const latestBaseline = (tx: Prisma.TransactionClient, testVariationId: string) =>
  tx.baseline.findFirst({ where: { testVariationId }, orderBy: { createdAt: 'desc' } });
