import { ConflictException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { IgnoreAreaDto } from './dto/ignore-area.dto';
import { StaticService } from '../static/static.service';
import { PrismaService } from '../prisma/prisma.service';
import { isPrismaError } from '../prisma/prisma-errors';
import { Prisma, Project, TestRun, TestStatus, TestVariation } from '@prisma/client';
import { DiffResult, StampedSignature } from './diffResult';
import { EventsGateway } from '../shared/events/events.gateway';
import { TestRunResultDto } from '../test-runs/dto/testRunResult.dto';
import { BaselineRef, TestVariationsService } from '../test-variations/test-variations.service';
import { TestRunDto } from './dto/testRun.dto';
import { getTestVariationUniqueData, parseIgnoreAreas, testRunImageNames, variationKey } from '../utils';
import { BoundedCache } from '../utils/bounded-cache';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { CompareService } from '../compare/compare.service';
import { UpdateTestRunDto } from './dto/update-test.dto';
import { parseConfig } from '../compare/utils';
import { DEFAULT_CONFIG } from '../compare/libs/pixelmatch/pixelmatch.service';
import { PixelmatchConfig } from '../compare/libs/pixelmatch/pixelmatch.types';
import { signaturesMatch, SIGNATURE_LENGTH } from '../compare/libs/pixelmatch/signature.core';
import type { WrapperType } from '../shared/wrapper-type';

@Injectable()
export class TestRunsService {
  private readonly logger: Logger = new Logger(TestRunsService.name);
  private readonly signatureCache = new BoundedCache<Promise<number[] | null>>(SIGNATURE_CACHE_SIZE);

  constructor(
    @Inject(forwardRef(() => TestVariationsService))
    private testVariationService: WrapperType<TestVariationsService>,
    private prismaService: PrismaService,
    private staticService: StaticService,
    private compareService: CompareService,
    private eventsGateway: EventsGateway
  ) {}

  async findMany(buildId: string): Promise<TestRunDto[]> {
    const list = await this.prismaService.testRun.findMany({
      where: { buildId },
    });
    return list.map((item) => new TestRunDto(item));
  }

  async findOne(id: string): Promise<TestRunWithVariation | null> {
    return this.prismaService.testRun.findUnique({
      where: { id },
      include: {
        testVariation: true,
      },
    });
  }

  async findOneOrThrow(id: string): Promise<TestRunWithVariation> {
    const testRun = await this.findOne(id);
    if (!testRun) {
      throw testRunNotFound(id);
    }
    return testRun;
  }

  async postTestRun({
    createTestRequestDto,
    imageBuffer,
  }: {
    createTestRequestDto: CreateTestRequestDto;
    imageBuffer: Buffer;
  }): Promise<TestRunResultDto> {
    const [project, build] = await Promise.all([
      this.prismaService.project.findUnique({ where: { id: createTestRequestDto.projectId } }),
      this.prismaService.build.findUnique({ where: { id: createTestRequestDto.buildId }, select: { projectId: true } }),
    ]);
    if (!project) {
      throw new NotFoundException(`Project not found: ${createTestRequestDto.projectId}`);
    }
    if (!build) {
      throw new NotFoundException(`Build not found: ${createTestRequestDto.buildId}`);
    }
    if (build.projectId !== createTestRequestDto.projectId) {
      this.logger.warn(
        `Build ${createTestRequestDto.buildId} does not belong to project ${createTestRequestDto.projectId}`
      );
    }
    this.compareService.getComparator(project.imageComparison);

    // allSettled, not all: a rejection must not leave the other promises unhandled or the screenshot orphaned
    const [savedImage, foundVariation, previousRuns] = await Promise.allSettled([
      this.staticService.saveImage('screenshot', imageBuffer),
      this.findOrCreateVariation(createTestRequestDto, project.mainBranchName),
      this.prismaService.testRun.findMany({
        where: {
          buildId: createTestRequestDto.buildId,
          branchName: createTestRequestDto.branchName,
          ...getTestVariationUniqueData(createTestRequestDto),
          NOT: { OR: [{ status: TestStatus.approved }, { status: TestStatus.autoApproved }] },
        },
      }),
    ]);
    if (
      savedImage.status === 'rejected' ||
      foundVariation.status === 'rejected' ||
      previousRuns.status === 'rejected'
    ) {
      if (savedImage.status === 'fulfilled') {
        await this.staticService.deleteImage(savedImage.value);
      }
      throw [savedImage, foundVariation, previousRuns].find((result) => result.status === 'rejected')!.reason;
    }
    const imageName = savedImage.value;
    const testVariation = foundVariation.value;
    const [previousTestRun] = previousRuns.value;

    let testRun: TestRun;
    try {
      if (previousTestRun) {
        await this.delete(previousTestRun.id);
      }
      testRun = await this.insertTestRun({ testVariation, createTestRequestDto, imageName });
    } catch (e) {
      await this.staticService.deleteImage(imageName);
      throw e;
    }
    let testRunWithResult = await this.calculateDiff(createTestRequestDto.projectId, testRun, imageBuffer, project);

    if (project.autoApproveFeature) {
      testRunWithResult = await this.tryAutoApproveByPastBaselines({
        testVariation,
        testRun: testRunWithResult,
        project,
        imageBuffer,
      });
      testRunWithResult = await this.tryAutoApproveByNewBaselines({
        testVariation,
        testRun: testRunWithResult,
        project,
        imageBuffer,
      });
    }
    return new TestRunResultDto(testRunWithResult, testVariation);
  }

  private async findOrCreateVariation(
    createTestRequestDto: CreateTestRequestDto,
    mainBranchName: string
  ): Promise<TestVariation> {
    return (
      (await this.testVariationService.find(createTestRequestDto, mainBranchName)) ??
      (await this.testVariationService.createOrTakeWinner(createTestRequestDto))
    );
  }

  async approve(id: string, merge = false, autoApprove = false, userId?: string): Promise<TestRun> {
    try {
      return await this.approveOnce(id, merge, autoApprove, userId);
    } catch (e) {
      if (isPrismaError(e, 'P2002')) {
        return this.approveOnce(id, merge, autoApprove, userId);
      }
      throw e;
    }
  }

  private async approveOnce(id: string, merge: boolean, autoApprove: boolean, userId?: string): Promise<TestRun> {
    this.logger.log(`Approving testRun: ${id} merge: ${merge} autoApprove: ${autoApprove}`);
    const testRun = await this.findOneOrThrow(id);
    const { testVariation } = testRun;
    if (!testVariation) {
      throw new ConflictException(NO_TEST_VARIATION);
    }
    if (await this.isAlreadyApproved(testRun, autoApprove)) {
      return testRun;
    }

    const toFeatureBranch = testRun.baselineBranchName !== testRun.branchName && !merge && !autoApprove;
    const addsBaseline = !autoApprove || testRun.baselineBranchName === testRun.branchName;
    const baselineName = addsBaseline ? await this.staticService.copyImage('baseline', testRun.imageName) : null;

    let claimed: boolean;
    try {
      claimed = await this.prismaService.$transaction(async (tx) => {
        const { count } = await tx.testRun.updateMany({
          where: { id, status: testRun.status },
          data: {
            status: autoApprove ? TestStatus.autoApproved : TestStatus.approved,
            statusBeforeDecision: testRun.status,
          },
        });
        if (count === 0) {
          return false;
        }
        let target: TestVariation = testVariation;
        if (toFeatureBranch) {
          const key = variationKey(testVariation.projectId, testRun.branchName, testRun);
          const featureBranchTestVariation =
            (await this.testVariationService.findUnique(key, tx)) ?? (await this.testVariationService.create(key, tx));
          target = await this.testVariationService.update(
            featureBranchTestVariation.id,
            { ignoreAreas: testRun.ignoreAreas, comment: testRun.comment },
            id,
            tx
          );
        }
        if (baselineName) {
          await this.testVariationService.addBaseline({ id: target.id, userId, testRunId: id, baselineName }, tx);
        }
        return true;
      });
    } catch (e) {
      await this.staticService.deleteImage(baselineName);
      throw e;
    }
    if (!claimed) {
      await this.staticService.deleteImage(baselineName);
      return (await this.findOne(id)) ?? testRun;
    }

    const approved = (await this.findOne(id))!;
    this.eventsGateway.testRunUpdated(approved);
    return approved;
  }

  private async isAlreadyApproved(testRun: TestRun, autoApprove: boolean): Promise<boolean> {
    if (testRun.status === TestStatus.approved) {
      return true;
    }
    if (testRun.status !== TestStatus.autoApproved) {
      return false;
    }
    return autoApprove || (await this.prismaService.baseline.count({ where: { testRunId: testRun.id } })) > 0;
  }

  async reject(id: string): Promise<TestRun> {
    const testRun = await this.prismaService.testRun.findUnique({ where: { id } });
    if (!testRun) {
      throw testRunNotFound(id);
    }
    if (testRun.status === TestStatus.failed) {
      return testRun;
    }
    const { count } = await this.prismaService.testRun.updateMany({
      where: { id, status: testRun.status },
      data: { status: TestStatus.failed, statusBeforeDecision: testRun.status },
    });
    const current = (await this.prismaService.testRun.findUnique({ where: { id } }))!;
    if (count > 0) {
      this.eventsGateway.testRunUpdated(current);
    }
    return current;
  }

  async revert(ids: string[]): Promise<void> {
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

    const freedBaselines = await this.prismaService.$transaction(async (tx) => {
      const freed: { name: string; baselineName: string }[] = [];
      for (const run of await this.orderForRevert(runs, tx)) {
        if (run.status === TestStatus.failed) {
          await this.restoreStatus(run, {}, tx);
        } else if (run.status === TestStatus.approved) {
          freed.push({ name: run.name, baselineName: await this.revertApproval(run, tx) });
        } else {
          throw new ConflictException(
            `Test run ${run.id} is ${run.status}: only approved or rejected runs can be reverted`
          );
        }
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

  private async orderForRevert(runs: TestRun[], tx: Prisma.TransactionClient): Promise<TestRun[]> {
    const approved = runs.filter((run) => run.status === TestStatus.approved);
    const baselines = await tx.baseline.findMany({
      where: { testRunId: { in: approved.map((run) => run.id) } },
      select: { testRunId: true, createdAt: true },
    });
    const approvedAt = new Map(baselines.map((baseline) => [baseline.testRunId, baseline.createdAt.getTime()]));
    approved.sort((a, b) => (approvedAt.get(b.id) ?? 0) - (approvedAt.get(a.id) ?? 0));
    return [...approved, ...runs.filter((run) => run.status !== TestStatus.approved)];
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
    const restoreBaselineName = () =>
      tx.testVariation.update({ where: { id: variation.id }, data: { baselineName: previous?.baselineName ?? null } });

    const wasFeatureBranchApproval =
      variation.branchName === run.branchName && run.baselineBranchName !== run.branchName;
    if (!wasFeatureBranchApproval) {
      await restoreBaselineName();
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
      await restoreBaselineName();
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

  private async findMatchingSiblings(
    id: string
  ): Promise<{ testRun: TestRun; matching: TestRun[]; skipped: SkippedSibling[] }> {
    const testRun = await this.findOneOrThrow(id);

    const project = testRun.projectId
      ? await this.prismaService.project.findUnique({ where: { id: testRun.projectId } })
      : null;
    if (!project?.bulkApproveVariations) {
      return { testRun, matching: [], skipped: [] };
    }

    const config: PixelmatchConfig = parseConfig(project.imageComparisonConfig, DEFAULT_CONFIG, this.logger);

    const groupBy = resolveGroupByAxis(project.bulkApproveGroupBy);
    const fixedAxes: Record<string, string | null> = {};
    for (const axis of GROUP_BY_AXES) {
      if (axis !== groupBy) {
        fixedAxes[axis] = testRun[axis] ?? null;
      }
    }

    const siblings = await this.prismaService.testRun.findMany({
      where: {
        id: { not: testRun.id },
        buildId: testRun.buildId,
        branchName: testRun.branchName,
        name: testRun.name,
        ...fixedAxes,
        status: { in: [TestStatus.unresolved, TestStatus.new] },
      },
    });

    const candidates = siblings.filter(
      (sibling) => !!sibling.diffPercent && magnitudesSimilar(testRun.diffPercent, sibling.diffPercent)
    );
    const [referenceSignature, ...candidateSignatures] = await mapWithConcurrency(
      [testRun, ...candidates],
      SIGNATURE_CONCURRENCY,
      (run) => this.getChangeSignature(run, config)
    );

    if (!referenceSignature) {
      return {
        testRun,
        matching: [],
        skipped: siblings.map((run) => ({ run, reason: 'no reference diff' })),
      };
    }

    const signatures = new Map(candidates.map((sibling, index) => [sibling.id, candidateSignatures[index]] as const));
    const matching: TestRun[] = [];
    const skipped: SkippedSibling[] = [];
    for (const sibling of siblings) {
      const signature = signatures.get(sibling.id);
      let reason: string | null = null;
      if (!sibling.diffPercent || signature === null) {
        reason = 'no diff to match';
      } else if (signature === undefined) {
        reason = 'different change size';
      } else if (!signaturesMatch(referenceSignature, signature)) {
        reason = 'different change pattern';
      }
      if (reason) {
        skipped.push({ run: sibling, reason });
      } else {
        matching.push(sibling);
      }
    }

    return { testRun, matching, skipped };
  }

  async getMatchingVariations(id: string): Promise<MatchingVariations> {
    const { testRun, matching, skipped } = await this.findMatchingSiblings(id);
    const variations = [testRun, ...matching].map((run) => new TestRunDto(run));
    const skippedDto = skipped.map((item) => ({ ...new TestRunDto(item.run), reason: item.reason }));
    return { variations, skipped: skippedDto };
  }

  private async getChangeSignature(testRun: TestRun, config: PixelmatchConfig): Promise<number[] | null> {
    const stored = parseStoredSignature(testRun.changeSignature, config, this.logger);
    if (stored) {
      return stored;
    }
    if (!testRun.baselineName) {
      return null;
    }
    const ignoreAreas = this.getAllIgnoreAreas(testRun);
    const key = [
      testRun.baselineName,
      testRun.imageName,
      config.threshold,
      config.ignoreAntialiasing,
      JSON.stringify(ignoreAreas),
    ].join('|');
    const cached = this.signatureCache.get(key);
    if (cached) {
      return cached;
    }

    const pending = this.computeChangeSignature(testRun, ignoreAreas, config);
    this.signatureCache.set(key, pending);
    pending.catch(() => this.signatureCache.delete(key));
    return pending;
  }

  private async computeChangeSignature(
    testRun: TestRun,
    ignoreAreas: IgnoreAreaDto[],
    config: PixelmatchConfig
  ): Promise<number[] | null> {
    const [baseline, image] = await Promise.all([
      this.staticService.getImageBuffer(testRun.baselineName),
      this.staticService.getImageBuffer(testRun.imageName),
    ]);
    if (!baseline || !image) {
      return null;
    }
    const { signature } = await this.compareService.getChangeSignature({
      baseline,
      image,
      ignoreAreas,
      threshold: config.threshold,
      includeAA: config.ignoreAntialiasing,
    });
    return signature;
  }

  async saveDiffResult(id: string, diffResult: DiffResult): Promise<TestRun> {
    const testRun = await this.prismaService.testRun.update({
      where: { id },
      data: {
        diffName: diffResult.diffName,
        pixelMisMatchCount: diffResult.pixelMisMatchCount,
        diffPercent: diffResult.diffPercent,
        status: diffResult.status,
        // null, not undefined: Prisma skips undefined and would keep the previous analysis
        vlmDescription: diffResult.vlmDescription ?? null,
        changeSignature: diffResult.changeSignature ? JSON.stringify(diffResult.changeSignature) : null,
        imageThumbnailName: diffResult.imageThumbnailName ?? null,
        diffThumbnailName: diffResult.diffThumbnailName ?? null,
      },
    });
    this.eventsGateway.testRunUpdated(testRun);
    return testRun;
  }

  async calculateDiff(projectId: string, testRun: TestRun, imageBuffer?: Buffer, project?: Project): Promise<TestRun> {
    const previous = [testRun.diffName, testRun.imageThumbnailName, testRun.diffThumbnailName];

    const diffResult = await this.compareService.getDiff({
      projectId,
      project,
      data: {
        image: testRun.imageName,
        imageBuffer,
        baseline: testRun.baselineName,
        ignoreAreas: this.getAllIgnoreAreas(testRun),
        diffTollerancePercent: testRun.diffTollerancePercent,
        saveDiffAsFile: true,
      },
    });
    const saved = await this.saveDiffResult(testRun.id, diffResult);

    for (const name of previous) void this.staticService.deleteImage(name);
    return saved;
  }

  async create({
    testVariation,
    createTestRequestDto,
    imageBuffer,
  }: {
    testVariation: TestVariation;
    createTestRequestDto: CreateTestRequestDto;
    imageBuffer: Buffer;
  }): Promise<TestRun> {
    const imageName = await this.staticService.saveImage('screenshot', imageBuffer);
    return this.insertTestRun({ testVariation, createTestRequestDto, imageName });
  }

  private async insertTestRun({
    testVariation,
    createTestRequestDto,
    imageName,
  }: {
    testVariation: TestVariation;
    createTestRequestDto: CreateTestRequestDto;
    imageName: string;
  }): Promise<TestRun> {
    let testRun: TestRun;
    try {
      testRun = await this.prismaService.testRun.create({
        data: {
          imageName,
          testVariationId: testVariation.id,
          buildId: createTestRequestDto.buildId,
          projectId: createTestRequestDto.projectId,
          ...getTestVariationUniqueData(testVariation),
          baselineName: testVariation.baselineName,
          baselineBranchName: testVariation.branchName,
          ignoreAreas: testVariation.ignoreAreas,
          tempIgnoreAreas: JSON.stringify(createTestRequestDto.ignoreAreas),
          comment: createTestRequestDto.comment || testVariation.comment,
          diffTollerancePercent: createTestRequestDto.diffTollerancePercent,
          branchName: createTestRequestDto.branchName,
          merge: createTestRequestDto.merge,
          status: TestStatus.new,
        },
      });
    } catch (e) {
      if (isPrismaError(e, 'P2003')) {
        throw new NotFoundException(
          `Build, project or test variation not found for test run ${createTestRequestDto.name}`
        );
      }
      throw e;
    }
    this.eventsGateway.testRunCreated(testRun);
    return testRun;
  }

  async delete(id: string): Promise<TestRun | undefined> {
    this.logger.debug(`Going to remove TestRun ${id}`);
    let testRun: TestRun;
    try {
      testRun = await this.prismaService.testRun.delete({ where: { id } });
    } catch (e) {
      if (isPrismaError(e, 'P2025')) {
        this.logger.warn(`TestRun not found ${id}`);
        return;
      }
      throw e;
    }
    await this.staticService.deleteImages(testRunImageNames(testRun));
    this.logger.log(`TestRun deleted ${id}`);
    this.eventsGateway.testRunDeleted(testRun);
    return testRun;
  }

  async updateIgnoreAreas(id: string, ignoreAreas: IgnoreAreaDto[]): Promise<TestRun> {
    const testVariationId = await this.getTestVariationId(id);
    const testRun = await this.prismaService.testRun.update({
      where: { id },
      data: {
        ignoreAreas: JSON.stringify(ignoreAreas),
      },
    });
    const testVariation = await this.testVariationService.update(testVariationId, {
      ignoreAreas: testRun.ignoreAreas,
    });
    return this.calculateDiff(testVariation.projectId, testRun);
  }

  async addIgnoreAreas(id: string, ignoreAreas: IgnoreAreaDto[]): Promise<TestRun> {
    const testRun = await this.findOneOrThrow(id);
    return this.updateIgnoreAreas(id, parseIgnoreAreas(testRun.ignoreAreas).concat(ignoreAreas));
  }

  async update(id: string, data: UpdateTestRunDto): Promise<TestRun> {
    const testVariationId = await this.getTestVariationId(id);
    const testRun = await this.prismaService.testRun.update({
      where: { id },
      data: {
        comment: data.comment,
      },
    });
    await this.testVariationService.update(testVariationId, { comment: data.comment });
    this.eventsGateway.testRunUpdated(testRun);
    return testRun;
  }

  private async getTestVariationId(id: string): Promise<string> {
    const testRun = await this.prismaService.testRun.findUnique({
      where: { id },
      select: { testVariationId: true },
    });
    if (!testRun) {
      throw testRunNotFound(id);
    }
    if (!testRun.testVariationId) {
      throw new ConflictException(NO_TEST_VARIATION);
    }
    return testRun.testVariationId;
  }

  private getAllIgnoreAreas(testRun: TestRun): IgnoreAreaDto[] {
    return parseIgnoreAreas(testRun.ignoreAreas).concat(parseIgnoreAreas(testRun.tempIgnoreAreas));
  }

  private async tryAutoApproveByPastBaselines({
    testRun,
    testVariation,
    project,
    imageBuffer,
  }: AutoApproveProps): Promise<TestRun> {
    if (testRun.status === TestStatus.ok || testRun.branchName === testRun.baselineBranchName) {
      return testRun;
    }

    this.logger.log(`Try AutoApproveByPastBaselines testRun: ${testRun.id}`);
    const [, ...pastBaselines] = await this.testVariationService.findBaselineHistory(testVariation.id);
    return this.autoApproveOnFirstMatch(project, testRun, pastBaselines, imageBuffer);
  }

  private async tryAutoApproveByNewBaselines({
    testVariation,
    testRun,
    project,
    imageBuffer,
  }: AutoApproveProps): Promise<TestRun> {
    if (testRun.status === TestStatus.ok || testRun.status === TestStatus.autoApproved) {
      return testRun;
    }
    this.logger.log(`Try AutoApproveByNewBaselines testRun: ${testRun.id}`);

    const alreadyApprovedTestRuns = await this.prismaService.testRun.findMany({
      where: {
        ...getTestVariationUniqueData(testVariation),
        baselineName: testVariation.baselineName,
        status: TestStatus.approved,
        testVariation: {
          projectId: testVariation.projectId,
        },
      },
      select: { testVariationId: true },
    });
    const testVariationIds = [
      ...new Set(alreadyApprovedTestRuns.flatMap(({ testVariationId }) => (testVariationId ? [testVariationId] : []))),
    ];
    const latestBaselines = await this.testVariationService.findLatestBaselines(testVariationIds);
    return this.autoApproveOnFirstMatch(project, testRun, latestBaselines, imageBuffer);
  }

  private async autoApproveOnFirstMatch(
    project: Project,
    testRun: TestRun,
    baselines: BaselineRef[],
    uploaded?: Buffer
  ): Promise<TestRun> {
    const seen = new Set<string>();
    const candidates = baselines.filter(({ baselineName }) => !seen.has(baselineName) && !!seen.add(baselineName));
    if (candidates.length === 0) {
      return testRun;
    }
    let imageBuffer = uploaded;
    if (!imageBuffer) {
      try {
        imageBuffer = (await this.staticService.getImageBuffer(testRun.imageName)) ?? undefined;
      } catch {
        imageBuffer = undefined;
      }
    }
    const ignoreAreas = this.getAllIgnoreAreas(testRun);
    for (const baseline of candidates) {
      if (await this.shouldAutoApprove({ project, baseline, testRun, imageBuffer, ignoreAreas })) {
        return this.approve(testRun.id, false, true);
      }
    }

    return testRun;
  }

  private async shouldAutoApprove({
    project,
    baseline,
    testRun,
    imageBuffer,
    ignoreAreas,
  }: {
    project: Project;
    baseline: BaselineRef;
    testRun: TestRun;
    imageBuffer?: Buffer;
    ignoreAreas: IgnoreAreaDto[];
  }): Promise<boolean> {
    const diffResult = await this.compareService.getDiff({
      projectId: project.id,
      project,
      data: {
        image: testRun.imageName,
        imageBuffer,
        baseline: baseline.baselineName,
        ignoreAreas,
        diffTollerancePercent: testRun.diffTollerancePercent,
        saveDiffAsFile: false,
      },
    });

    if (diffResult.status !== TestStatus.ok) {
      return false;
    }
    this.logger.log(`TestRun ${testRun.id} could be auto approved based on Baseline ${baseline.id}`);
    return true;
  }
}

interface AutoApproveProps {
  testVariation: TestVariation;
  testRun: TestRun;
  project: Project;
  imageBuffer?: Buffer;
}

export interface MatchingVariations {
  variations: TestRunDto[];
  skipped: Array<TestRunDto & { reason: string }>;
}

interface SkippedSibling {
  run: TestRun;
  reason: string;
}

type TestRunWithVariation = TestRun & { testVariation: TestVariation | null };

const testRunNotFound = (id: string) => new NotFoundException(`Test run not found: ${id}`);

const latestBaseline = (tx: Prisma.TransactionClient, testVariationId: string) =>
  tx.baseline.findFirst({ where: { testVariationId }, orderBy: { createdAt: 'desc' } });

const NO_TEST_VARIATION = 'No test variation found. Re-create test run';

const GROUP_BY_AXES = ['customTags', 'os', 'device', 'browser', 'viewport'] as const;

function resolveGroupByAxis(value: string | null | undefined): string {
  return value && (GROUP_BY_AXES as readonly string[]).includes(value) ? value : 'customTags';
}

export const SIGNATURE_CONCURRENCY = 8;

const SIGNATURE_CACHE_SIZE = 2000;

function parseStoredSignature(
  stored: string | null | undefined,
  config: PixelmatchConfig,
  logger: Logger
): number[] | null {
  if (!stored) {
    return null;
  }
  try {
    const parsed: StampedSignature = JSON.parse(stored);
    const wellFormed =
      Array.isArray(parsed?.signature) &&
      parsed.signature.length === SIGNATURE_LENGTH &&
      parsed.signature.every((value) => typeof value === 'number' && Number.isFinite(value));
    if (!wellFormed) {
      return null;
    }
    const sameConfig = parsed.threshold === config.threshold && parsed.includeAA === config.ignoreAntialiasing;
    return sameConfig ? parsed.signature : null;
  } catch (error) {
    logger.warn(`Ignoring unreadable stored change signature: ${error}`);
    return null;
  }
}

const MATCH_MAGNITUDE_RATIO = 2;

function magnitudesSimilar(a: number | null, b: number | null): boolean {
  const min = Math.min(a ?? 0, b ?? 0);
  const max = Math.max(a ?? 0, b ?? 0);
  if (min <= 0) {
    return max <= 0;
  }
  return max / min <= MATCH_MAGNITUDE_RATIO;
}
