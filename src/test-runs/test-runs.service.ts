import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { PNG } from 'pngjs';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { IgnoreAreaDto } from './dto/ignore-area.dto';
import { StaticService } from '../shared/static/static.service';
import { PrismaService } from '../prisma/prisma.service';
import { Baseline, TestRun, TestStatus, TestVariation } from '@prisma/client';
import { DiffResult } from './diffResult';
import { EventsGateway } from '../shared/events/events.gateway';
import { TestRunResultDto } from '../test-runs/dto/testRunResult.dto';
import { TestVariationsService } from '../test-variations/test-variations.service';
import { TestRunDto } from './dto/testRun.dto';
import { getTestVariationUniqueData } from '../utils';
import { CompareService } from '../compare/compare.service';
import { UpdateTestRunDto } from './dto/update-test.dto';

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
    const baseline = this.staticService.getImage(testRun.imageName);
    const baselineName = this.staticService.saveImage('baseline', PNG.sync.write(baseline));

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
