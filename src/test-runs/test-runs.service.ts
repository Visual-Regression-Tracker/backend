import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { PNG } from 'pngjs';
import Pixelmatch from 'pixelmatch';
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
import { applyIgnoreAreas, parseConfig } from '../compare/utils';
import { DEFAULT_CONFIG } from '../compare/libs/pixelmatch/pixelmatch.service';
import { PixelmatchConfig } from '../compare/libs/pixelmatch/pixelmatch.types';

@Injectable()
export class TestRunsService {
  private readonly logger: Logger = new Logger(TestRunsService.name);

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

    // save new baseline
    const baseline = await this.staticService.getImage(testRun.imageName);
    const baselineName = await this.staticService.saveImage('baseline', PNG.sync.write(baseline));

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

    const referenceSignature = await this.getChangeSignature(testRun, config);
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

    if (!referenceSignature) {
      for (const sibling of siblings) {
        skipped.push({ run: sibling, reason: 'no reference diff' });
      }
      return { testRun, matching, skipped };
    }

    for (const sibling of siblings) {
      const signature = await this.getChangeSignature(sibling, config);
      if (!signature) {
        skipped.push({ run: sibling, reason: 'no diff to match' });
      } else if (!signaturesMatch(referenceSignature, signature)) {
        skipped.push({ run: sibling, reason: 'different change pattern' });
      } else if (!magnitudesSimilar(testRun.diffPercent, sibling.diffPercent)) {
        skipped.push({ run: sibling, reason: 'different change size' });
      } else {
        matching.push(sibling);
      }
    }

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
   * baseline and image: a normalized histogram of the colors the changed pixels
   * took in the new image. Null when there is no baseline, dimensions differ, or
   * nothing changed.
   */
  private async getChangeSignature(testRun: TestRun, config: PixelmatchConfig): Promise<number[] | null> {
    if (!testRun.baselineName) {
      return null;
    }
    const baseline = await this.staticService.getImage(testRun.baselineName);
    const image = await this.staticService.getImage(testRun.imageName);
    if (!baseline || !image || baseline.width !== image.width || baseline.height !== image.height) {
      return null;
    }
    // Apply ignore areas exactly as the diff does, so masked regions never count
    // toward the change signature.
    const ignoreAreas = this.getAllIgnoteAreas(testRun);
    applyIgnoreAreas(baseline, ignoreAreas);
    applyIgnoreAreas(image, ignoreAreas);
    return changeColorSignature(baseline, image, {
      threshold: config.threshold,
      includeAA: config.ignoreAntialiasing,
    });
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

// Colors are quantized to this many levels per RGB channel, giving
// COLOR_BUCKETS_PER_CHANNEL^3 histogram buckets.
const COLOR_BUCKETS_PER_CHANNEL = 4;
// Two changes are considered the same pattern when their color signatures'
// cosine similarity is at least this value.
const SIGNATURE_SIMILARITY_THRESHOLD = 0.9;

// Longest side (px) images are downscaled to before computing the color
// signature — keeps the histogram representative while cutting pixelmatch cost.
const SIGNATURE_MAX_DIMENSION = 500;

// Nearest-neighbour downscale so the longest side is at most maxDimension.
// Returns the original when already small enough.
function downscale(
  source: { data: Buffer; width: number; height: number },
  maxDimension: number
): { data: Buffer; width: number; height: number } {
  const scale = maxDimension / Math.max(source.width, source.height);
  if (scale >= 1) {
    return source;
  }
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const data: Buffer = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(source.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(source.width - 1, Math.floor(x / scale));
      const sourceIndex = (sourceY * source.width + sourceX) * 4;
      const targetIndex = (y * width + x) * 4;
      data[targetIndex] = source.data[sourceIndex];
      data[targetIndex + 1] = source.data[sourceIndex + 1];
      data[targetIndex + 2] = source.data[sourceIndex + 2];
      data[targetIndex + 3] = source.data[sourceIndex + 3];
    }
  }
  return { data, width, height };
}

/**
 * Position-independent signature of a change: a normalized histogram of the
 * colors that the changed pixels take in the new image. Because it ignores
 * *where* the change is, it is robust to per-locale layout shifts (a title
 * wrapping to a different number of lines, options moving down, etc.) while
 * still capturing *what* changed (a selection highlight, a recolored button).
 */
function changeColorSignature(
  baselineImage: { data: Buffer; width: number; height: number },
  checkpointImage: { data: Buffer; width: number; height: number },
  options: { threshold: number; includeAA: boolean }
): number[] | null {
  // The signature is a coarse color histogram, so full resolution is wasteful —
  // downscale first to make pixelmatch (CPU-bound, run per variation) much faster.
  const baseline = downscale(baselineImage, SIGNATURE_MAX_DIMENSION);
  const image = downscale(checkpointImage, SIGNATURE_MAX_DIMENSION);
  const { width, height } = baseline;
  const mask = new PNG({ width, height });
  const changedPixels = Pixelmatch(baseline.data, image.data, mask.data, width, height, {
    threshold: options.threshold,
    includeAA: options.includeAA,
    diffMask: true,
  });
  if (changedPixels === 0) {
    return null;
  }

  const bucketSize = 256 / COLOR_BUCKETS_PER_CHANNEL;
  const histogram = new Array(COLOR_BUCKETS_PER_CHANNEL ** 3).fill(0);
  for (let i = 0; i < width * height; i++) {
    if (mask.data[i * 4 + 3] === 0) {
      continue;
    }
    const r = Math.min(COLOR_BUCKETS_PER_CHANNEL - 1, Math.floor(image.data[i * 4] / bucketSize));
    const g = Math.min(COLOR_BUCKETS_PER_CHANNEL - 1, Math.floor(image.data[i * 4 + 1] / bucketSize));
    const b = Math.min(COLOR_BUCKETS_PER_CHANNEL - 1, Math.floor(image.data[i * 4 + 2] / bucketSize));
    histogram[r * COLOR_BUCKETS_PER_CHANNEL * COLOR_BUCKETS_PER_CHANNEL + g * COLOR_BUCKETS_PER_CHANNEL + b]++;
  }

  const total = histogram.reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return null;
  }
  return histogram.map((value) => value / total);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function signaturesMatch(a: number[], b: number[]): boolean {
  return cosineSimilarity(a, b) >= SIGNATURE_SIMILARITY_THRESHOLD;
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
