import { ConflictException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { IgnoreAreaDto } from './dto/ignore-area.dto';
import { StaticService } from '../static/static.service';
import { PrismaService } from '../prisma/prisma.service';
import { isPrismaError } from '../prisma/prisma-errors';
import { Prisma, Project, TestRun, TestStatus, TestVariation } from '@prisma/client';
import { DiffResult } from './diffResult';
import { EventsGateway } from '../shared/events/events.gateway';
import { TestRunResultDto } from '../test-runs/dto/testRunResult.dto';
import { BaselineRef, TestVariationsService } from '../test-variations/test-variations.service';
import { TestRunDto } from './dto/testRun.dto';
import { getTestVariationUniqueData, parseIgnoreAreas, testRunImageNames, variationKey } from '../utils';
import { messageOf } from '../utils/errors';
import { CompareService } from '../compare/compare.service';
import { UpdateTestRunDto } from './dto/update-test.dto';
import type { WrapperType } from '../shared/wrapper-type';
import { RevertDecision, TestRunRevertService } from './test-run-revert.service';
import { MatchingVariations, TestRunMatchingService } from './test-run-matching.service';
import {
  getAllIgnoreAreas,
  NO_TEST_VARIATION,
  TestRunAlreadyDecidedException,
  testRunNotFound,
} from './test-runs.shared';

@Injectable()
export class TestRunsService {
  private readonly logger: Logger = new Logger(TestRunsService.name);

  constructor(
    @Inject(forwardRef(() => TestVariationsService))
    private testVariationService: WrapperType<TestVariationsService>,
    private prismaService: PrismaService,
    private staticService: StaticService,
    private compareService: CompareService,
    private eventsGateway: EventsGateway,
    private revertService: TestRunRevertService,
    private matchingService: TestRunMatchingService
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
      throw new TestRunAlreadyDecidedException(`Test run ${id} is already approved`);
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
        let before: TestVariation | undefined;
        if (toFeatureBranch) {
          const key = variationKey(testVariation.projectId, testRun.branchName, testRun);
          before =
            (await this.testVariationService.findUnique(key, tx)) ?? (await this.testVariationService.create(key, tx));
          target = await this.testVariationService.update(
            before.id,
            { ignoreAreas: testRun.ignoreAreas, comment: testRun.comment },
            id,
            tx
          );
        }
        if (baselineName) {
          await this.testVariationService.addBaseline(
            { id: target.id, userId, testRunId: id, baselineName, before },
            tx
          );
        }
        return true;
      });
    } catch (e) {
      await this.staticService.deleteImage(baselineName);
      throw e;
    }
    if (!claimed) {
      await this.staticService.deleteImage(baselineName);
      throw changedMeanwhile(id);
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
      throw new TestRunAlreadyDecidedException(`Test run ${id} is already rejected`);
    }
    const { count } = await this.prismaService.testRun.updateMany({
      where: { id, status: testRun.status },
      data: { status: TestStatus.failed, statusBeforeDecision: testRun.status },
    });
    if (count === 0) {
      throw changedMeanwhile(id);
    }
    const current = (await this.prismaService.testRun.findUnique({ where: { id } }))!;
    this.eventsGateway.testRunUpdated(current);
    return current;
  }

  revert(ids: string[], decision?: RevertDecision): Promise<void> {
    return this.revertService.revert(ids, decision);
  }

  async getMatchingVariations(id: string): Promise<MatchingVariations> {
    return this.matchingService.getMatchingVariations(await this.findOneOrThrow(id));
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
        noiseAnalysis: Prisma.DbNull,
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
        ignoreAreas: getAllIgnoreAreas(testRun),
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
    const { projectId, ownVariationId } = await this.findEditedVariation(id);
    const testRun = await this.prismaService.testRun.update({
      where: { id },
      data: {
        ignoreAreas: JSON.stringify(ignoreAreas),
      },
    });
    if (ownVariationId) {
      await this.testVariationService.update(ownVariationId, { ignoreAreas: testRun.ignoreAreas });
    }
    return this.calculateDiff(projectId, testRun);
  }

  async addIgnoreAreas(id: string, ignoreAreas: IgnoreAreaDto[]): Promise<TestRun> {
    const testRun = await this.findOneOrThrow(id);
    return this.updateIgnoreAreas(id, parseIgnoreAreas(testRun.ignoreAreas).concat(ignoreAreas));
  }

  async update(id: string, data: UpdateTestRunDto): Promise<TestRun> {
    const { ownVariationId } = await this.findEditedVariation(id);
    const testRun = await this.prismaService.testRun.update({
      where: { id },
      data: {
        comment: data.comment,
      },
    });
    if (ownVariationId) {
      await this.testVariationService.update(ownVariationId, { comment: data.comment });
    }
    this.eventsGateway.testRunUpdated(testRun);
    return testRun;
  }

  private async findEditedVariation(id: string): Promise<{ projectId: string; ownVariationId?: string }> {
    const testRun = await this.prismaService.testRun.findUnique({
      where: { id },
      select: { branchName: true, testVariation: { select: { id: true, branchName: true, projectId: true } } },
    });
    if (!testRun) {
      throw testRunNotFound(id);
    }
    const { testVariation } = testRun;
    if (!testVariation) {
      throw new ConflictException(NO_TEST_VARIATION);
    }
    // a run compared against another branch keeps its edits until approve copies them to its own branch
    const ownVariationId = testVariation.branchName === testRun.branchName ? testVariation.id : undefined;
    return { projectId: testVariation.projectId, ownVariationId };
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
      } catch (error) {
        this.logger.warn(
          `Auto-approve continues without the uploaded image of test run ${testRun.id}: ${messageOf(error)}`
        );
        imageBuffer = undefined;
      }
    }
    const ignoreAreas = getAllIgnoreAreas(testRun);
    for (const baseline of candidates) {
      if (await this.shouldAutoApprove({ project, baseline, testRun, imageBuffer, ignoreAreas })) {
        try {
          return await this.approve(testRun.id, false, true);
        } catch (e) {
          if (!(e instanceof TestRunAlreadyDecidedException)) throw e;
          return (await this.findOne(testRun.id)) ?? testRun;
        }
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

const changedMeanwhile = (id: string) =>
  new TestRunAlreadyDecidedException(`Test run ${id} was changed by someone else meanwhile`);

type TestRunWithVariation = TestRun & { testVariation: TestVariation | null };
