import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TestVariation, Baseline, Build, TestRun, User } from '@prisma/client';
import { StaticService } from '../shared/static/static.service';
import { BuildsService } from '../builds/builds.service';
import { TestRunsService } from '../test-runs/test-runs.service';
import { PNG } from 'pngjs';
import { CreateTestRequestDto } from 'src/test-runs/dto/create-test-request.dto';
import { BuildDto } from 'src/builds/dto/build.dto';
import { getTestVariationUniqueData } from '../utils';
import { TestVariationUpdateDto } from './dto/test-variation-update.dto';
import { BaselineDataDto } from 'src/shared/dto/baseline-data.dto';

@Injectable()
export class TestVariationsService {
  private readonly logger = new Logger(TestVariationsService.name);

  constructor(
    private prismaService: PrismaService,
    private staticService: StaticService,
    @Inject(forwardRef(() => TestRunsService))
    private testRunsService: TestRunsService,
    @Inject(forwardRef(() => BuildsService))
    private buildsService: BuildsService
  ) {}

  async getDetails(
    id: string
  ): Promise<TestVariation & { baselines: (Baseline & { testRun: TestRun; user: User })[] }> {
    return this.prismaService.testVariation.findUnique({
      where: { id },
      include: {
        baselines: {
          include: {
            testRun: true,
            user: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });
  }

  async findUnique(data: BaselineDataDto & { projectId: string }): Promise<TestVariation | null> {
    return this.prismaService.testVariation.findUnique({
      where: {
        projectId_name_browser_device_os_viewport_customTags_branchName: {
          projectId: data.projectId,
          name: data.name,
          browser: data.browser,
          device: data.device,
          os: data.os,
          viewport: data.viewport,
          customTags: data.customTags,
          branchName: data.branchName,
        },
      },
    });
  }

  async update(id: string, data: TestVariationUpdateDto, testRunId?: string): Promise<TestVariation> {
    return this.prismaService.testVariation.update({
      where: { id },
      data: {
        baselineName: data.baselineName,
        ignoreAreas: data.ignoreAreas,
        comment: data.comment,
        testRuns: testRunId ? { connect: { id: testRunId } } : undefined,
      },
    });
  }

  /**
   * Tries to get test variation for the same branch
   * Falls back to main branch if not found
   * @param projectId
   * @param baselineData
   * @returns
   */
  async find(
    createTestRequestDto: BaselineDataDto & { projectId: string; sourceBranch?: string }
  ): Promise<TestVariation | null> {
    const project = await this.prismaService.project.findUnique({ where: { id: createTestRequestDto.projectId } });
    const mainBranch = createTestRequestDto.sourceBranch ?? project.mainBranchName;

    const [mainBranchTestVariation, currentBranchTestVariation] = await Promise.all([
      // search main branch variation
      this.findUnique({
        projectId: createTestRequestDto.projectId,
        branchName: mainBranch,
        ...getTestVariationUniqueData(createTestRequestDto),
      }),
      // search current branch variation
      createTestRequestDto.branchName !== mainBranch &&
        this.findUnique({
          projectId: createTestRequestDto.projectId,
          branchName: createTestRequestDto.branchName,
          ...getTestVariationUniqueData(createTestRequestDto),
        }),
    ]);

    if (!!currentBranchTestVariation) {
      if (mainBranchTestVariation && mainBranchTestVariation.updatedAt > currentBranchTestVariation.updatedAt) {
        return mainBranchTestVariation;
      }
      return currentBranchTestVariation;
    }

    if (!!mainBranchTestVariation) {
      return mainBranchTestVariation;
    }
  }

  /**
   * Creates empty test variation (no baseline)
   */
  create({
    testRunId,
    createTestRequestDto,
  }: {
    testRunId?: string;
    createTestRequestDto: Omit<CreateTestRequestDto, 'buildId' | 'ignoreAreas'>;
  }): Promise<TestVariation> {
    return this.prismaService.testVariation.create({
      data: {
        project: { connect: { id: createTestRequestDto.projectId } },
        testRuns: testRunId ? { connect: { id: testRunId } } : undefined,
        branchName: createTestRequestDto.branchName,
        ...getTestVariationUniqueData(createTestRequestDto),
      },
    });
  }

  async addBaseline({
    id,
    userId,
    testRunId,
    baselineName,
  }: {
    id: string;
    userId: string;
    testRunId: string;
    baselineName: string;
  }): Promise<TestVariation> {
    return this.prismaService.testVariation.update({
      where: { id },
      data: {
        baselineName,
        baselines: {
          create: {
            baselineName,
            testRun: {
              connect: {
                id: testRunId,
              },
            },
            user: userId
              ? {
                  connect: {
                    id: userId,
                  },
                }
              : undefined,
          },
        },
      },
    });
  }

  async merge(projectId: string, fromBranch: string, toBranch: string): Promise<BuildDto> {
    // create build
    const build: Build = await this.buildsService.findOrCreate({
      branchName: toBranch,
      projectId,
    });

    // find source branch variations
    const testVariations: TestVariation[] = await this.prismaService.testVariation.findMany({
      where: { projectId, branchName: fromBranch },
    });

    // compare source to destination branch variations
    for (const sourceBranchTestVariation of testVariations) {
      const baseline = this.staticService.getImage(sourceBranchTestVariation.baselineName);
      if (baseline) {
        // get destination branch request
        const createTestRequestDto: CreateTestRequestDto = {
          ...sourceBranchTestVariation,
          branchName: toBranch,
          buildId: build.id,
          diffTollerancePercent: 0,
          merge: true,
          ignoreAreas: JSON.parse(sourceBranchTestVariation.ignoreAreas),
        };

        // get destination branch variation
        let destintionBranchTestVariation = await this.find({
          projectId,
          branchName: toBranch,
          ...getTestVariationUniqueData(sourceBranchTestVariation),
        });

        if (destintionBranchTestVariation?.branchName !== toBranch) {
          destintionBranchTestVariation = await this.create({ createTestRequestDto });
        }

        const testRun = await this.testRunsService.create({
          testVariation: destintionBranchTestVariation,
          createTestRequestDto,
          imageBuffer: PNG.sync.write(baseline),
        });

        await this.testRunsService.calculateDiff(projectId, testRun);
      }
    }

    // stop build
    return this.buildsService.update(build.id, { isRunning: false });
  }

  async delete(id: string): Promise<TestVariation> {
    this.logger.debug(`Going to remove TestVariation ${id}`);
    const testVariation = await this.getDetails(id);

    // delete Baselines
    for (const baseline of testVariation.baselines) {
      await this.deleteBaseline(baseline);
    }

    // disconnect TestRuns
    // workaround due to  https://github.com/prisma/prisma/issues/2810
    await this.prismaService
      .$executeRaw`UPDATE "public"."TestRun" SET "testVariationId" = NULL::text WHERE "testVariationId" = ${id}`;

    // delete TestVariation
    return this.prismaService.testVariation.delete({
      where: { id },
    });
  }

  async deleteBaseline(baseline: Baseline): Promise<Baseline> {
    this.logger.debug(`Going to remove Baseline ${baseline.id}`);

    this.staticService.deleteImage(baseline.baselineName);
    return this.prismaService.baseline.delete({
      where: { id: baseline.id },
    });
  }
}
