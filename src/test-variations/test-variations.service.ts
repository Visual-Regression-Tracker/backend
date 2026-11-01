import { Injectable, Inject, forwardRef, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isPrismaError } from '../prisma/prisma-errors';
import { TestVariation, Baseline, Build, Project, TestRun, User, Prisma } from '@prisma/client';
import { StaticService } from '../static/static.service';
import { BuildsService } from '../builds/builds.service';
import { TestRunsService } from '../test-runs/test-runs.service';
import { CreateTestRequestDto } from '../test-runs/dto/create-test-request.dto';
import { BuildDto } from '../builds/dto/build.dto';
import { getTestVariationUniqueData, parseIgnoreAreas, variationKey } from '../utils';
import { TestVariationUpdateDto } from './dto/test-variation-update.dto';
import { BaselineDataDto } from '../shared/dto/baseline-data.dto';
import type { WrapperType } from '../shared/wrapper-type';

export type BaselineRef = Pick<Baseline, 'id' | 'baselineName'>;

@Injectable()
export class TestVariationsService {
  private readonly logger = new Logger(TestVariationsService.name);

  constructor(
    private prismaService: PrismaService,
    private staticService: StaticService,
    @Inject(forwardRef(() => TestRunsService))
    private testRunsService: WrapperType<TestRunsService>,
    @Inject(forwardRef(() => BuildsService))
    private buildsService: WrapperType<BuildsService>
  ) {}

  async getDetails(id: string): Promise<
    TestVariation & {
      baselines: (Baseline & { testRun: TestRun | null; user: Omit<User, 'password' | 'apiKey'> | null })[];
    }
  > {
    const testVariation = await this.prismaService.testVariation.findUnique({
      where: { id },
      include: {
        baselines: {
          include: {
            testRun: true,
            user: { omit: { password: true, apiKey: true } },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });
    if (!testVariation) {
      throw new NotFoundException(`Test variation not found: ${id}`);
    }
    return testVariation;
  }

  async findBaselineHistory(testVariationId: string): Promise<BaselineRef[]> {
    return this.prismaService.baseline.findMany({
      where: { testVariationId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, baselineName: true },
    });
  }

  async findLatestBaselines(testVariationIds: string[]): Promise<BaselineRef[]> {
    if (testVariationIds.length === 0) {
      return [];
    }
    const baselines = await this.prismaService.baseline.findMany({
      where: { testVariationId: { in: testVariationIds } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, baselineName: true, testVariationId: true },
    });
    const latest = new Map<string, BaselineRef>();
    for (const { testVariationId, ...baseline } of baselines) {
      if (!latest.has(testVariationId)) {
        latest.set(testVariationId, baseline);
      }
    }
    return testVariationIds.flatMap((id) => latest.get(id) ?? []);
  }

  async findUnique(
    data: ReturnType<typeof getTestVariationUniqueData> & { projectId: string; branchName: string },
    tx: Prisma.TransactionClient = this.prismaService
  ): Promise<TestVariation | null> {
    return tx.testVariation.findUnique({
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

  async update(
    id: string,
    data: TestVariationUpdateDto,
    testRunId?: string,
    tx: Prisma.TransactionClient = this.prismaService
  ): Promise<TestVariation> {
    return tx.testVariation.update({
      where: { id },
      data: {
        baselineName: data.baselineName,
        ignoreAreas: data.ignoreAreas,
        comment: data.comment,
        testRuns: testRunId ? { connect: { id: testRunId } } : undefined,
      },
    });
  }

  async find(
    createTestRequestDto: BaselineDataDto & { projectId: string; sourceBranch?: string },
    mainBranchName?: string
  ): Promise<TestVariation | undefined> {
    const mainBranch =
      createTestRequestDto.sourceBranch ??
      mainBranchName ??
      (await this.prismaService.project.findUnique({ where: { id: createTestRequestDto.projectId } }))!.mainBranchName;

    const [mainBranchTestVariation, currentBranchTestVariation] = await Promise.all([
      this.findUnique(variationKey(createTestRequestDto.projectId, mainBranch, createTestRequestDto)),
      createTestRequestDto.branchName !== mainBranch &&
        this.findUnique(
          variationKey(createTestRequestDto.projectId, createTestRequestDto.branchName, createTestRequestDto)
        ),
    ]);

    if (currentBranchTestVariation) {
      if (mainBranchTestVariation && mainBranchTestVariation.updatedAt > currentBranchTestVariation.updatedAt) {
        return mainBranchTestVariation;
      }
      return currentBranchTestVariation;
    }

    return mainBranchTestVariation ?? undefined;
  }

  create(
    { createTestRequestDto }: { createTestRequestDto: Omit<CreateTestRequestDto, 'buildId' | 'ignoreAreas'> },
    tx: Prisma.TransactionClient = this.prismaService
  ): Promise<TestVariation> {
    return tx.testVariation.create({
      data: {
        project: { connect: { id: createTestRequestDto.projectId } },
        branchName: createTestRequestDto.branchName,
        ...getTestVariationUniqueData(createTestRequestDto),
      },
    });
  }

  async createOrTakeWinner(
    createTestRequestDto: Omit<CreateTestRequestDto, 'buildId' | 'ignoreAreas'>
  ): Promise<TestVariation> {
    try {
      return await this.create({ createTestRequestDto });
    } catch (e) {
      if (isPrismaError(e, 'P2002')) {
        const winner = await this.findUnique(
          variationKey(createTestRequestDto.projectId, createTestRequestDto.branchName, createTestRequestDto)
        );
        if (winner) {
          return winner;
        }
      }
      throw e;
    }
  }

  async addBaseline(
    {
      id,
      userId,
      testRunId,
      baselineName,
    }: {
      id: string;
      userId?: string;
      testRunId: string;
      baselineName: string;
    },
    tx: Prisma.TransactionClient = this.prismaService
  ): Promise<TestVariation> {
    return tx.testVariation.update({
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
    const build: Build = await this.buildsService.findOrCreate({
      branchName: toBranch,
      projectId,
    });

    try {
      const project = await this.prismaService.project.findUnique({ where: { id: projectId } });
      if (!project) {
        throw new NotFoundException(`Project not found: ${projectId}`);
      }
      await this.mergeInto(build, project, fromBranch, toBranch);
    } catch (e) {
      await this.buildsService.update(build.id, { isRunning: false }).catch((): void => undefined);
      throw e;
    }

    return this.buildsService.update(build.id, { isRunning: false });
  }

  private async mergeInto(build: Build, project: Project, fromBranch: string, toBranch: string): Promise<void> {
    const testVariations: TestVariation[] = await this.prismaService.testVariation.findMany({
      where: { projectId: project.id, branchName: fromBranch },
    });

    for (const sourceBranchTestVariation of testVariations) {
      const baselineBuffer = await this.staticService.getImageBuffer(sourceBranchTestVariation.baselineName);
      if (baselineBuffer) {
        const createTestRequestDto: CreateTestRequestDto = {
          ...sourceBranchTestVariation,
          branchName: toBranch,
          buildId: build.id,
          diffTollerancePercent: 0,
          merge: true,
          ignoreAreas: parseIgnoreAreas(sourceBranchTestVariation.ignoreAreas),
        };

        // not find(): it may return main's variation and the merge would create a second one on toBranch
        const destinationBranchTestVariation =
          (await this.findUnique(variationKey(project.id, toBranch, createTestRequestDto))) ??
          (await this.createOrTakeWinner(createTestRequestDto));

        const testRun = await this.testRunsService.create({
          testVariation: destinationBranchTestVariation,
          createTestRequestDto,
          imageBuffer: baselineBuffer,
        });

        await this.testRunsService.calculateDiff(project.id, testRun, baselineBuffer, project);
      }
    }
  }

  async delete(id: string): Promise<TestVariation> {
    this.logger.debug(`Going to remove TestVariation ${id}`);
    const baselines = await this.prismaService.baseline.findMany({
      where: { testVariationId: id },
      select: { baselineName: true },
    });
    const [, testVariation] = await this.prismaService.$transaction([
      this.prismaService.baseline.deleteMany({ where: { testVariationId: id } }),
      this.prismaService.testVariation.delete({ where: { id } }),
    ]);
    await this.staticService.deleteImages(
      baselines.map(({ baselineName }) => baselineName),
      8
    );
    return testVariation;
  }
}
