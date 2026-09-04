import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { IgnoreAreaDto } from './dto/ignore-area.dto';
import { StaticService } from '../static/static.service';
import { PrismaService } from '../prisma/prisma.service';
import { Baseline, Prisma, TestRun, TestStatus, TestVariation } from '@prisma/client';
import { DiffResult } from './diffResult';
import { EventsGateway } from '../shared/events/events.gateway';
import { TestRunResultDto } from '../test-runs/dto/testRunResult.dto';
import { TestVariationsService } from '../test-variations/test-variations.service';
import { TestRunDto } from './dto/testRun.dto';
import { getTestVariationUniqueData } from '../utils';
import { CompareService } from '../compare/compare.service';
import { UpdateTestRunDto } from './dto/update-test.dto';
import { parseConfig } from '../compare/utils';
import { DEFAULT_CONFIG } from '../compare/libs/pixelmatch/pixelmatch.service';
import { PixelmatchConfig } from '../compare/libs/pixelmatch/pixelmatch.types';
import { signaturesMatch } from '../compare/libs/pixelmatch/signature.core';

@Injectable()
export class TestRunsService {
  private readonly logger: Logger = new Logger(TestRunsService.name);
  private readonly signatureCache = new BoundedCache<Promise<number[] | null>>(SIGNATURE_CACHE_SIZE);

  constructor(
    @Inject(forwardRef(() => TestVariationsService))
    private testVariationService: TestVariationsService,
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

  async findOne(id: string): Promise<
    TestRun & {
      testVariation?: TestVariation;
    }
  > {
    return this.prismaService.testRun.findUnique({
      where: { id },
      include: {
        testVariation: true,
      },
    });
  }

  async postTestRun({
    createTestRequestDto,
    imageBuffer,
  }: {
    createTestRequestDto: CreateTestRequestDto;
    imageBuffer: Buffer;
  }): Promise<TestRunResultDto> {
    const project = await this.prismaService.project.findUnique({ where: { id: createTestRequestDto.projectId } });

    let testVariation = await this.testVariationService.find(createTestRequestDto);
    // creates variatioin if does not exist
    if (!testVariation) {
      testVariation = await this.testVariationService.create({
        createTestRequestDto,
      });
    }

    // delete previous test run if exists
    const [previousTestRun] = await this.prismaService.testRun.findMany({
      where: {
        buildId: createTestRequestDto.buildId,
        branchName: createTestRequestDto.branchName,
        ...getTestVariationUniqueData(createTestRequestDto),
        NOT: { OR: [{ status: TestStatus.approved }, { status: TestStatus.autoApproved }] },
      },
    });
    if (!!previousTestRun) {
      await this.delete(previousTestRun.id);
    }

    // create test run result
    const testRun = await this.create({ testVariation, createTestRequestDto, imageBuffer });

    // calculate diff
    let testRunWithResult = await this.calculateDiff(createTestRequestDto.projectId, testRun);

    // try auto approve
    if (project.autoApproveFeature) {
      testRunWithResult = await this.tryAutoApproveByPastBaselines({ testVariation, testRun: testRunWithResult });
      testRunWithResult = await this.tryAutoApproveByNewBaselines({ testVariation, testRun: testRunWithResult });
    }
    return new TestRunResultDto(testRunWithResult, testVariation);
  }

  /**
   * Confirm difference for testRun
   */
  async approve(id: string, merge = false, autoApprove = false, userId?: string): Promise<TestRun> {
    this.logger.log(`Approving testRun: ${id} merge: ${merge} autoApprove: ${autoApprove}`);
    const testRun = await this.findOne(id);
    let { testVariation } = testRun;
    if (!testVariation) {
      throw new Error('No test variation found. Re-create test run');
    }

    // save new baseline as a byte-for-byte copy — decoding and re-encoding the
    // PNG here blocked the event loop for every approved run
    const baselineName = await this.staticService.copyImage('baseline', testRun.imageName);

    if (testRun.baselineBranchName !== testRun.branchName && !merge && !autoApprove) {
      // replace main branch with feature branch test variation
      const featureBranchTestVariation = await this.testVariationService.findUnique({
        ...testRun,
      });

      if (!featureBranchTestVariation) {
        testVariation = await this.testVariationService.create({
          testRunId: id,
          createTestRequestDto: {
            projectId: testRun.projectId,
            branchName: testRun.branchName,
            ...getTestVariationUniqueData(testRun),
          },
        });
      } else {
        testVariation = featureBranchTestVariation;
      }

      // carry over data from testRun
      testVariation = await this.testVariationService.update(
        testVariation.id,
        {
          baselineName: testRun.baselineName,
          ignoreAreas: testRun.ignoreAreas,
          comment: testRun.comment,
        },
        testRun.id
      );
    }

    if (!autoApprove || (autoApprove && testRun.baselineBranchName === testRun.branchName)) {
      // add baseline
      await this.testVariationService.addBaseline({
        id: testVariation.id,
        userId,
        testRunId: testRun.id,
        baselineName,
      });
    }

    // update status
    const status = autoApprove ? TestStatus.autoApproved : TestStatus.approved;
    return this.setStatus(id, status);
  }

  /**
   * Finds sibling variations of a test run in the same build — same screen
   * (name) and same test-variation axes except the one configured on the project
   * as `bulkApproveGroupBy` (customTags by default, i.e. per-locale screenshots).
   * The feature is opt-in per project via `bulkApproveVariations`.
   *
   * Matching uses a position-independent color signature of the changed pixels
   * (which colors appeared/changed), so it survives per-locale layout shifts —
   * e.g. a title wrapping to a different number of lines pushes the whole screen
   * down, but the same change (a moved selection, a recolored button) still
   * produces the same signature. A loose guard on change size (diffPercent) also
   * skips variations whose change area is far larger/smaller — a same-palette but
   * additional/different change — while tolerating per-locale text reflow.
   * Siblings that don't match, or have no diff to compare, are reported as
   * skipped. Used by {@link getMatchingVariations}.
   */
  private async findMatchingSiblings(
    id: string
  ): Promise<{ testRun: TestRun; matching: TestRun[]; skipped: SkippedSibling[] }> {
    const testRun = await this.findOne(id);
    if (!testRun) {
      throw new Error(`No test run found: ${id}`);
    }

    const project = testRun.projectId
      ? await this.prismaService.project.findUnique({ where: { id: testRun.projectId } })
      : null;
    if (!project?.bulkApproveVariations) {
      return { testRun, matching: [], skipped: [] };
    }

    // Mirror the project's diff config so the change signature classifies the
    // same way the normal pixelmatch diff does, rather than a hardcoded threshold.
    const config: PixelmatchConfig = {
      ...DEFAULT_CONFIG,
      ...parseConfig(project.imageComparisonConfig, DEFAULT_CONFIG, this.logger),
    };

    const groupBy = resolveGroupByAxis(project.bulkApproveGroupBy);
    const fixedAxes: Record<string, string | null> = {};
    for (const axis of GROUP_BY_AXES) {
      if (axis !== groupBy) {
        fixedAxes[axis] = (testRun as unknown as Record<string, string | null>)[axis] ?? null;
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

    const matching: TestRun[] = [];
    const skipped: SkippedSibling[] = [];

    // Comparing change sizes is free, computing a signature costs two decoded
    // screenshots — so the cheap test goes first and takes those siblings out
    // of the expensive pass entirely.
    const candidates: TestRun[] = [];
    for (const sibling of siblings) {
      if (!sibling.diffPercent) {
        // Nothing changed on this one, so there is no change to recognise —
        // the same verdict the signature pass would have reached, for free.
        skipped.push({ run: sibling, reason: 'no diff to match' });
      } else if (!magnitudesSimilar(testRun.diffPercent, sibling.diffPercent)) {
        skipped.push({ run: sibling, reason: 'different change size' });
      } else {
        candidates.push(sibling);
      }
    }

    // The reviewed run and every remaining sibling are signed in one bounded
    // fan-out across the worker pool. Signing them one after another is what
    // made this dialog take tens of seconds on a build with many locales.
    const [referenceSignature, ...candidateSignatures] = await mapWithConcurrency(
      [testRun, ...candidates],
      SIGNATURE_CONCURRENCY,
      (run) => this.getChangeSignature(run, config)
    );

    // Nothing to match against: every sibling goes to manual review, whatever
    // the cheap pass made of it.
    if (!referenceSignature) {
      return {
        testRun,
        matching,
        skipped: siblings.map((run) => ({ run, reason: 'no reference diff' })),
      };
    }

    candidates.forEach((sibling, index) => {
      const signature = candidateSignatures[index];
      if (!signature) {
        skipped.push({ run: sibling, reason: 'no diff to match' });
      } else if (!signaturesMatch(referenceSignature, signature)) {
        skipped.push({ run: sibling, reason: 'different change pattern' });
      } else {
        matching.push(sibling);
      }
    });

    // The cheap pass ran first, so restore the order the siblings came in —
    // the dialog lists them as one group and its order should not depend on
    // which test rejected a sibling.
    const orderOf = new Map(siblings.map((sibling, index) => [sibling.id, index] as const));
    skipped.sort((a, b) => orderOf.get(a.run.id) - orderOf.get(b.run.id));

    return { testRun, matching, skipped };
  }

  /**
   * Returns the group of variations for the reviewed run — the run itself plus
   * the sibling variations whose change matches it — for the reviewer to confirm
   * before a bulk approve/reject. Nothing is mutated here: the actual action is
   * driven by the reviewer's explicit selection (regular approve/reject of the
   * chosen ids), so a regression that merely looks similar can never be approved
   * without a human seeing it. `skipped` lists siblings left out of the group
   * (different/additional change, or no diff to compare).
   */
  async getMatchingVariations(
    id: string
  ): Promise<{ variations: TestRunDto[]; skipped: Array<TestRunDto & { reason: string }> }> {
    const { testRun, matching, skipped } = await this.findMatchingSiblings(id);
    const variations = [testRun, ...matching].map((run) => new TestRunDto(run));
    const skippedDto = skipped.map((item) => ({ ...new TestRunDto(item.run), reason: item.reason }));
    return { variations, skipped: skippedDto };
  }

  /**
   * Position-independent color signature of the change between a test run's
   * baseline and image. Null when there is no baseline, dimensions differ, or
   * nothing changed.
   *
   * Normally this was written at ingest, beside the diff that had already
   * decoded both screenshots, and grouping a screen costs nothing but the row
   * it is read from. The rest of this is the fallback for runs that carry no
   * stored signature — ingested before the column existed, or compared by
   * something other than pixelmatch: their bytes go to the worker pool
   * undecoded, and the result is memoized so reopening the dialog on an old
   * build does not pay for the same decodes twice.
   */
  private async getChangeSignature(testRun: TestRun, config: PixelmatchConfig): Promise<number[] | null> {
    const stored = parseStoredSignature(testRun.changeSignature, this.logger);
    if (stored) {
      return stored;
    }
    if (!testRun.baselineName) {
      return null;
    }
    const ignoreAreas = this.getAllIgnoteAreas(testRun);
    // Image names are unique per upload, so only the ignore areas and the
    // project's diff config can change a signature under a stable pair.
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
    // A failed read must not be remembered as "no signature" forever.
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

  async setStatus(id: string, status: TestStatus): Promise<TestRun> {
    const testRun = await this.prismaService.testRun.update({
      where: { id },
      data: {
        status,
      },
    });

    this.eventsGateway.testRunUpdated(testRun);
    return this.findOne(id);
  }

  async saveDiffResult(id: string, diffResult: DiffResult): Promise<TestRun> {
    return this.prismaService.testRun
      .update({
        where: { id },
        data: {
          diffName: diffResult && diffResult.diffName,
          pixelMisMatchCount: diffResult && diffResult.pixelMisMatchCount,
          diffPercent: diffResult && diffResult.diffPercent,
          status: diffResult ? diffResult.status : TestStatus.new,
          vlmDescription: diffResult && diffResult?.vlmDescription,
          // Always written, never merged: a recomputed diff — after the
          // reviewer edits the ignore areas, say — must not leave the previous
          // signature behind describing a change that no longer exists.
          changeSignature: diffResult?.changeSignature ? JSON.stringify(diffResult.changeSignature) : null,
        },
      })
      .then((testRun) => {
        this.eventsGateway.testRunUpdated(testRun);
        return testRun;
      });
  }

  async calculateDiff(projectId: string, testRun: TestRun): Promise<TestRun> {
    this.staticService.deleteImage(testRun.diffName);
    const diffResult = await this.compareService.getDiff({
      projectId,
      data: {
        image: testRun.imageName,
        baseline: testRun.baselineName,
        ignoreAreas: this.getAllIgnoteAreas(testRun),
        diffTollerancePercent: testRun.diffTollerancePercent,
        saveDiffAsFile: true,
      },
    });
    return this.saveDiffResult(testRun.id, diffResult);
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
    // save image
    const imageName = await this.staticService.saveImage('screenshot', imageBuffer);

    const testRun = await this.prismaService.testRun.create({
      data: {
        imageName,
        testVariation: {
          connect: {
            id: testVariation.id,
          },
        },
        build: {
          connect: {
            id: createTestRequestDto.buildId,
          },
        },
        project: {
          connect: {
            id: createTestRequestDto.projectId,
          },
        },
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

    this.eventsGateway.testRunCreated(testRun);
    return testRun;
  }

  async delete(id: string): Promise<TestRun> {
    this.logger.debug(`Going to remove TestRun ${id}`);
    const testRun = await this.findOne(id);

    if (!testRun) {
      this.logger.warn(`TestRun not found ${id}`);
      return;
    }

    await Promise.all([
      this.staticService.deleteImage(testRun.diffName),
      this.staticService.deleteImage(testRun.imageName),
    ]);

    try {
      await this.prismaService.testRun.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        // workaround https://github.com/Visual-Regression-Tracker/Visual-Regression-Tracker/issues/435
        if (e.code === 'P2025') {
          this.logger.warn(`TestRun already deleted ${id}`);
          return;
        }
      }
    }

    this.logger.log(`TestRun deleted ${id}`);
    this.eventsGateway.testRunDeleted(testRun);
    return testRun;
  }

  async updateIgnoreAreas(id: string, ignoreAreas: IgnoreAreaDto[]): Promise<TestRun> {
    return this.prismaService.testRun
      .update({
        where: { id },
        data: {
          ignoreAreas: JSON.stringify(ignoreAreas),
        },
      })
      .then(async (testRun: TestRun) => {
        const testVariation = await this.testVariationService.update(testRun.testVariationId, {
          ignoreAreas: testRun.ignoreAreas,
        });
        return this.calculateDiff(testVariation.projectId, testRun);
      });
  }

  async addIgnoreAreas(id: string, ignoreAreas: IgnoreAreaDto[]): Promise<TestRun> {
    const testRun = await this.findOne(id);
    const oldIgnoreAreas: IgnoreAreaDto[] = JSON.parse(testRun.ignoreAreas) ?? [];
    return this.updateIgnoreAreas(id, oldIgnoreAreas.concat(ignoreAreas));
  }

  async update(id: string, data: UpdateTestRunDto): Promise<TestRun> {
    return this.prismaService.testRun
      .update({
        where: { id },
        data: {
          comment: data.comment,
        },
      })
      .then(async (testRun) => {
        await this.testVariationService.update(testRun.testVariationId, data);
        this.eventsGateway.testRunUpdated(testRun);
        return testRun;
      });
  }

  private getAllIgnoteAreas(testRun: TestRun): IgnoreAreaDto[] {
    const ignoreAreas: IgnoreAreaDto[] = JSON.parse(testRun.ignoreAreas) ?? [];
    const tempIgnoreAreas: IgnoreAreaDto[] = JSON.parse(testRun.tempIgnoreAreas) ?? [];
    return ignoreAreas.concat(tempIgnoreAreas);
  }

  /**
   * Reason: not rebased code from feature branch is compared agains new main branch baseline thus diff is expected
   * Tries to find past baseline in main branch and autoApprove in case matched
   * @param testVariation
   * @param testRun
   */
  private async tryAutoApproveByPastBaselines({ testRun, testVariation }: AutoApproveProps): Promise<TestRun> {
    if (testRun.status === TestStatus.ok || testRun.branchName === testRun.baselineBranchName) {
      return testRun;
    }

    this.logger.log(`Try AutoApproveByPastBaselines testRun: ${testRun.id}`);
    const testVariationHistory = await this.testVariationService.getDetails(testVariation.id);
    // skip first baseline as it was used by default in general flow
    for (const baseline of testVariationHistory.baselines.slice(1)) {
      if (await this.shouldAutoApprove({ projectId: testVariation.projectId, baseline, testRun })) {
        return this.approve(testRun.id, false, true);
      }
    }

    return testRun;
  }

  /**
   * Reason: branch got another one merged thus diff is expected
   * Tries to find latest baseline in test variation
   * that has already approved test agains the same baseline image
   * and autoApprove in case matched
   * @param testVariation
   * @param testRun
   */
  private async tryAutoApproveByNewBaselines({ testVariation, testRun }: AutoApproveProps): Promise<TestRun> {
    if (testRun.status === TestStatus.ok) {
      return testRun;
    }
    this.logger.log(`Try AutoApproveByNewBaselines testRun: ${testRun.id}`);

    const alreadyApprovedTestRuns: TestRun[] = await this.prismaService.testRun.findMany({
      where: {
        ...getTestVariationUniqueData(testVariation),
        baselineName: testVariation.baselineName,
        status: TestStatus.approved,
        testVariation: {
          projectId: testVariation.projectId,
        },
      },
    });

    for (const approvedTestRun of alreadyApprovedTestRuns) {
      const approvedTestVariation = await this.testVariationService.getDetails(approvedTestRun.testVariationId);
      const baseline = approvedTestVariation.baselines.shift();

      if (await this.shouldAutoApprove({ projectId: testVariation.projectId, baseline, testRun })) {
        return this.approve(testRun.id, false, true);
      }
    }

    return testRun;
  }

  private async shouldAutoApprove({
    projectId,
    baseline,
    testRun,
  }: {
    projectId: string;
    baseline: Baseline;
    testRun: TestRun;
  }): Promise<boolean> {
    const diffResult = await this.compareService.getDiff({
      projectId,
      data: {
        image: testRun.imageName,
        baseline: baseline.baselineName,
        ignoreAreas: this.getAllIgnoteAreas(testRun),
        diffTollerancePercent: testRun.diffTollerancePercent,
        saveDiffAsFile: false,
      },
    });

    if (diffResult.status === TestStatus.ok) {
      this.logger.log(`TestRun ${testRun.id} could be auto approved based on Baseline ${baseline.id}`);
      return true;
    }
  }
}

interface AutoApproveProps {
  testVariation: TestVariation;
  testRun: TestRun;
}

interface SkippedSibling {
  run: TestRun;
  reason: string;
}

// Test-variation axes a project may bulk-approve across (the one that varies
// within a group). customTags (e.g. locales) is the default.
const GROUP_BY_AXES = ['customTags', 'os', 'device', 'browser', 'viewport'] as const;

function resolveGroupByAxis(value: string | null | undefined): string {
  return value && (GROUP_BY_AXES as readonly string[]).includes(value) ? value : 'customTags';
}

// How many sibling screenshots may be in the worker pool at once for one
// variations dialog. The pool queue is shared with build ingestion, and every
// queued job holds two image buffers, so the fan-out stays bounded rather than
// handing the pool a job per locale.
export const SIGNATURE_CONCURRENCY = 8;

// Signatures kept across requests, keyed by the image pair and diff settings.
// Roughly one build's worth of screens, at 64 floats each.
const SIGNATURE_CACHE_SIZE = 2000;

/**
 * Insertion-ordered cache with a hard size limit: reviewing build after build
 * would otherwise grow the signature memo without bound. Reinserting a key
 * refreshes its position, so what the reviewer keeps coming back to survives.
 */
class BoundedCache<T> {
  private readonly entries = new Map<string, T>();

  constructor(private readonly limit: number) {}

  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.limit) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }
}

/**
 * Runs `task` over every item with at most `limit` in flight, keeping the
 * results in the items' order.
 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * The signature stored on a run, or null when there is none to read. Bad JSON
 * is not worth failing a review over: the caller falls back to computing it.
 */
function parseStoredSignature(stored: string | null | undefined, logger: Logger): number[] | null {
  if (!stored) {
    return null;
  }
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch (error) {
    logger.warn(`Ignoring unreadable stored change signature: ${error}`);
    return null;
  }
}

// Same palette but a much larger/smaller change area signals a different or
// additional change (an extra element changed too), not just per-locale text
// reflow — which stays well under this ratio. Such variations go to manual review.
const MATCH_MAGNITUDE_RATIO = 2;

function magnitudesSimilar(a: number | null, b: number | null): boolean {
  const min = Math.min(a ?? 0, b ?? 0);
  const max = Math.max(a ?? 0, b ?? 0);
  if (min <= 0) {
    return max <= 0;
  }
  return max / min <= MATCH_MAGNITUDE_RATIO;
}
