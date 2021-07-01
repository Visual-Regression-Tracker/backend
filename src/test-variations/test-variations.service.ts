import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TestVariation, Baseline, Project, Prisma, Build, TestRun } from '@prisma/client';
import { StaticService } from '../shared/static/static.service';
import { BaselineDataDto } from '../shared/dto/baseline-data.dto';
import { BuildsService } from '../builds/builds.service';
import { TestRunsService } from '../test-runs/test-runs.service';
import { PNG } from 'pngjs';
import { CreateTestRequestDto } from 'src/test-runs/dto/create-test-request.dto';
import { BuildDto } from 'src/builds/dto/build.dto';
import { getTestVariationUniqueData } from '../utils';
import { TestVariationUpdateDto } from './dto/test-variation-update.dto';

@Injectable()
export class TestVariationsService {
  constructor(
    private prismaService: PrismaService,
    private staticService: StaticService,
    @Inject(forwardRef(() => TestRunsService))
    private testRunsService: TestRunsService,
    @Inject(forwardRef(() => BuildsService))
    private buildsService: BuildsService
  ) {}

  async getDetails(id: string): Promise<TestVariation & { baselines: Baseline[] }> {
    return this.prismaService.testVariation.findUnique({
      where: { id },
      include: {
        baselines: {
          include: {
            testRun: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });
  }

  async findUnique(
    data: Prisma.ProjectIdNameBrowserDeviceOsViewportCustomTagsBranchNameCompoundUniqueInput
  ): Promise<TestVariation | null> {
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
    createTestRequestDto: Omit<CreateTestRequestDto, 'buildId' | 'ignoreAreas'>
  ): Promise<TestVariation | null> {
    const project = await this.prismaService.project.findUnique({ where: { id: createTestRequestDto.projectId } });

    const [mainBranchTestVariation, currentBranchTestVariation] = await Promise.all([
      // search main branch variation
      this.findUnique({
        projectId: createTestRequestDto.projectId,
        branchName: project.mainBranchName,
        ...getTestVariationUniqueData(createTestRequestDto),
      }),
      // search current branch variation
      createTestRequestDto.branchName !== project.mainBranchName &&
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
    testRunId,
    baselineName,
  }: {
    id: string;
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
          },
        },
      },
    });
  }

  async merge(projectId: string, branchName: string): Promise<BuildDto> {
    const project: Project = await this.prismaService.project.findUnique({ where: { id: projectId } });

    // create build
    const build: Build = await this.buildsService.findOrCreate({
      branchName: project.mainBranchName,
      projectId,
    });

    // find side branch variations
    const testVariations: TestVariation[] = await this.prismaService.testVariation.findMany({
      where: { projectId, branchName },
    });

    // compare to main branch variations
    await Promise.all(
      testVariations.map(async (sideBranchTestVariation) => {
        const baseline = this.staticService.getImage(sideBranchTestVariation.baselineName);
        if (baseline) {
          try {
            // get main branch variation
            const mainBranchTestVariation = await this.find({
              projectId,
              branchName: project.mainBranchName,
              ...getTestVariationUniqueData(sideBranchTestVariation),
            });

            // get side branch request
            const createTestRequestDto: CreateTestRequestDto = {
              ...sideBranchTestVariation,
              buildId: build.id,
              diffTollerancePercent: 0,
              merge: true,
              ignoreAreas: JSON.parse(sideBranchTestVariation.ignoreAreas),
            };

            return this.testRunsService.create({
              testVariation: mainBranchTestVariation,
              createTestRequestDto,
              imageBuffer: PNG.sync.write(baseline),
            });
          } catch (err) {
            console.log(err);
          }
        }
      })
    );

    // stop build
    return this.buildsService.update(build.id, { isRunning: false });
  }

  async delete(id: string): Promise<TestVariation> {
    const testVariation = await this.getDetails(id);

    // delete Baselines
    await Promise.all(testVariation.baselines.map((baseline) => this.deleteBaseline(baseline)));

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
    this.staticService.deleteImage(baseline.baselineName);
    return this.prismaService.baseline.delete({
      where: { id: baseline.id },
    });
  }
}
