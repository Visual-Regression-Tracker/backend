import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { PNG } from 'pngjs';
import Pixelmatch from 'pixelmatch';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { IgnoreAreaDto } from './dto/ignore-area.dto';
import { StaticService } from '../shared/static/static.service';
import { PrismaService } from '../prisma/prisma.service';
import { Baseline, TestRun, TestStatus, TestVariation } from '@prisma/client';
import { DiffResult } from './diffResult';
import { EventsGateway } from '../shared/events/events.gateway';
import { CommentDto } from '../shared/dto/comment.dto';
import { TestRunResultDto } from '../test-runs/dto/testRunResult.dto';
import { TestVariationsService } from '../test-variations/test-variations.service';
import { TestRunDto } from './dto/testRun.dto';
import { getTestVariationUniqueData } from '../utils';

@Injectable()
export class TestRunsService {
  private readonly logger: Logger = new Logger(TestRunsService.name);

  constructor(
    @Inject(forwardRef(() => TestVariationsService))
    private testVariationService: TestVariationsService,
    private prismaService: PrismaService,
    private staticService: StaticService,
    private eventsGateway: EventsGateway
  ) {}

  async findMany(buildId: string): Promise<TestRunDto[]> {
    const list = await this.prismaService.testRun.findMany({
      where: { buildId },
    });
    return list.map((item) => new TestRunDto(item));
  }

  async findOne(
    id: string
  ): Promise<
    TestRun & {
      testVariation: TestVariation;
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
    // creates variatioin if does not exist
    const testVariation = await this.testVariationService.findOrCreate(createTestRequestDto.projectId, {
      ...getTestVariationUniqueData(createTestRequestDto),
      branchName: createTestRequestDto.branchName,
    });

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
    let testRunWithResult = await this.calculateDiff(testRun);

    // try auto approve
    testRunWithResult = await this.tryAutoApproveByPastBaselines(testVariation, testRunWithResult);
    testRunWithResult = await this.tryAutoApproveByNewBaselines(testVariation, testRunWithResult);
    return new TestRunResultDto(testRunWithResult, testVariation);
  }

  /**
   * Confirm difference for testRun
   *
   * @param id
   * @param merge replaces main branch baseline with feature one
   * @param autoApprove set auto approve status
   * @returns
   */
  async approve(id: string, merge = false, autoApprove = false): Promise<TestRun> {
    this.logger.log(`Approving testRun: ${id} merge: ${merge} autoApprove: ${autoApprove}`);
    const testRun = await this.findOne(id);
    let testVariation = testRun.testVariation;

    // save new baseline
    const baseline = this.staticService.getImage(testRun.imageName);
    const baselineName = this.staticService.saveImage('baseline', PNG.sync.write(baseline));

    if (testRun.baselineBranchName !== testRun.branchName && !merge && !autoApprove) {
      testVariation = await this.testVariationService.updateOrCreate({
        projectId: testVariation.projectId,
        baselineName,
        testRun,
      });
    }

    if (!autoApprove || (autoApprove && testRun.baselineBranchName === testRun.branchName)) {
      // add baseline
      await this.testVariationService.addBaseline({
        id: testVariation.id,
        testRunId: testRun.id,
        baselineName,
      });
    }

    // update status
    const status = autoApprove ? TestStatus.autoApproved : TestStatus.approved;
    return this.setStatus(id, status);
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
        },
      })
      .then((testRun) => {
        this.eventsGateway.testRunUpdated(testRun);
        return testRun;
      });
  }

  async calculateDiff(testRun: TestRun): Promise<TestRun> {
    const baseline = this.staticService.getImage(testRun.baselineName);
    const image = this.staticService.getImage(testRun.imageName);
    this.staticService.deleteImage(testRun.diffName);

    const diffResult = this.getDiff(baseline, image, testRun);
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
    const imageName = this.staticService.saveImage('screenshot', imageBuffer);

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
        ...getTestVariationUniqueData(testVariation),
        baselineName: testVariation.baselineName,
        baselineBranchName: testVariation.branchName,
        ignoreAreas: testVariation.ignoreAreas,
        tempIgnoreAreas: JSON.stringify(createTestRequestDto.ignoreAreas),
        comment: testVariation.comment,
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
    const testRun = await this.findOne(id);

    await Promise.all([
      this.staticService.deleteImage(testRun.diffName),
      this.staticService.deleteImage(testRun.imageName),
      this.prismaService.testRun.delete({
        where: { id },
      }),
    ]);

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
      .then((testRun) => this.calculateDiff(testRun));
  }

  async updateComment(id: string, commentDto: CommentDto): Promise<TestRun> {
    return this.prismaService.testRun
      .update({
        where: { id },
        data: {
          comment: commentDto.comment,
        },
      })
      .then((testRun) => {
        this.eventsGateway.testRunUpdated(testRun);
        return testRun;
      });
  }

  private scaleImageToSize(image: PNG, width: number, height: number): PNG {
    if (width > image.width || height > image.height) {
      const preparedImage = new PNG({ width, height, fill: true });
      PNG.bitblt(image, preparedImage, 0, 0, image.width, image.height);
      return preparedImage;
    }
    return image;
  }

  getDiff(baseline: PNG, image: PNG, testRun: TestRun): DiffResult {
    const result: DiffResult = {
      status: undefined,
      diffName: null,
      pixelMisMatchCount: undefined,
      diffPercent: undefined,
      isSameDimension: undefined,
    };

    if (!baseline) {
      // no baseline
      return result;
    }

    result.isSameDimension = baseline.width === image.width && baseline.height === image.height;

    if (!result.isSameDimension && !process.env.ALLOW_DIFF_DIMENSIONS) {
      // diff dimensions
      result.status = TestStatus.unresolved;
      return result;
    }
    // scale image to max size
    const maxWidth = Math.max(baseline.width, image.width);
    const maxHeight = Math.max(baseline.height, image.height);
    const scaledBaseline = this.scaleImageToSize(baseline, maxWidth, maxHeight);
    const scaledImage = this.scaleImageToSize(image, maxWidth, maxHeight);

    // apply ignore areas
    const ignoreAreas = this.getIgnoteAreas(testRun);
    const baselineData = this.applyIgnoreAreas(scaledBaseline, ignoreAreas);
    const imageData = this.applyIgnoreAreas(scaledImage, ignoreAreas);

    // compare
    const diff = new PNG({
      width: maxWidth,
      height: maxHeight,
    });
    result.pixelMisMatchCount = Pixelmatch(baselineData, imageData, diff.data, maxWidth, maxHeight, {
      includeAA: true,
    });
    result.diffPercent = (result.pixelMisMatchCount * 100) / (scaledImage.width * scaledImage.height);

    // process result
    if (result.diffPercent > testRun.diffTollerancePercent) {
      // save diff
      result.diffName = this.staticService.saveImage('diff', PNG.sync.write(diff));
      result.status = TestStatus.unresolved;
    } else {
      result.status = TestStatus.ok;
    }
    return result;
  }

  private applyIgnoreAreas(image: PNG, ignoreAreas: IgnoreAreaDto[]): Buffer {
    ignoreAreas.forEach((area) => {
      for (let y = area.y; y < area.y + area.height; y++) {
        for (let x = area.x; x < area.x + area.width; x++) {
          const k = 4 * (image.width * y + x);
          image.data[k + 0] = 0;
          image.data[k + 1] = 0;
          image.data[k + 2] = 0;
          image.data[k + 3] = 0;
        }
      }
    });
    return image.data;
  }

  private getIgnoteAreas(testRun: TestRun): IgnoreAreaDto[] {
    let ignoreAreas: IgnoreAreaDto[] = JSON.parse(testRun.ignoreAreas);
    if (testRun.ignoreAreas?.length > 0) {
      ignoreAreas = ignoreAreas.concat(JSON.parse(testRun.tempIgnoreAreas));
    }
    return ignoreAreas;
  }

  /**
   * Reason: not rebased code from feature branch is compared agains new main branch baseline thus diff is expected
   * Tries to find past baseline in main branch and autoApprove in case matched
   * @param testVariation
   * @param testRun
   * @param ignoreAreas
   */
  private async tryAutoApproveByPastBaselines(testVariation: TestVariation, testRun: TestRun): Promise<TestRun> {
    if (
      !process.env.AUTO_APPROVE_BASED_ON_HISTORY ||
      testRun.status === TestStatus.ok ||
      testRun.branchName === testRun.baselineBranchName
    ) {
      return testRun;
    }

    this.logger.log(`Try AutoApproveByPastBaselines testRun: ${testRun.id}`);
    const testVariationHistory = await this.testVariationService.getDetails(testVariation.id);
    // skip first baseline as it was used by default in general flow
    for (const baseline of testVariationHistory.baselines.slice(1)) {
      if (this.shouldAutoApprove(baseline, testRun)) {
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
   * @param image
   * @param ignoreAreas
   */
  private async tryAutoApproveByNewBaselines(testVariation: TestVariation, testRun: TestRun): Promise<TestRun> {
    if (!process.env.AUTO_APPROVE_BASED_ON_HISTORY || testRun.status === TestStatus.ok) {
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

      if (this.shouldAutoApprove(baseline, testRun)) {
        return this.approve(testRun.id, false, true);
      }
    }

    return testRun;
  }

  private shouldAutoApprove(baseline: Baseline, testRun: TestRun): boolean {
    const approvedImage = this.staticService.getImage(baseline.baselineName);
    const image = this.staticService.getImage(testRun.imageName);
    const diffResult = this.getDiff(approvedImage, image, testRun);

    if (diffResult.status === TestStatus.ok) {
      this.logger.log(`TestRun ${testRun.id} could be auto approved based on Baseline ${baseline.id}`);
      return true;
    }
  }
}
