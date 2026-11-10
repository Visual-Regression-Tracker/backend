import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isPrismaError } from '../prisma/prisma-errors';
import { TestVariation, Baseline, TestRun, User, Prisma } from '@prisma/client';
import { StaticService } from '../static/static.service';
import { VariationKey, getTestVariationUniqueData, variationKey } from '../utils';
import { TestVariationUpdateDto } from './dto/test-variation-update.dto';
import { BaselineDataDto } from '../shared/dto/baseline-data.dto';

export type BaselineRef = Pick<Baseline, 'id' | 'baselineName'>;

type NewVariation = BaselineDataDto & { projectId: string };

@Injectable()
export class TestVariationsService {
  private readonly logger = new Logger(TestVariationsService.name);

  constructor(
    private prismaService: PrismaService,
    private staticService: StaticService
  ) {}

  async getDetails(id: string): Promise<
    TestVariation & {
      baselines: (Omit<Baseline, 'ignoreAreasBeforeApproval' | 'commentBeforeApproval'> & {
        testRun: TestRun | null;
        user: Omit<User, 'password' | 'apiKey'> | null;
      })[];
    }
  > {
    const testVariation = await this.prismaService.testVariation.findUnique({
      where: { id },
      include: {
        baselines: {
          omit: { ignoreAreasBeforeApproval: true, commentBeforeApproval: true },
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
    data: VariationKey,
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
      if (mainBranchTestVariation) {
        const [mainAt, currentAt] = await Promise.all([
          this.latestApprovalAt(mainBranchTestVariation.id),
          this.latestApprovalAt(currentBranchTestVariation.id),
        ]);
        if (mainAt > currentAt) {
          return mainBranchTestVariation;
        }
      }
      return currentBranchTestVariation;
    }

    return mainBranchTestVariation ?? undefined;
  }

  private async latestApprovalAt(testVariationId: string): Promise<number> {
    const baseline = await this.prismaService.baseline.findFirst({
      where: { testVariationId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return baseline?.createdAt.getTime() ?? -Infinity;
  }

  create(data: NewVariation, tx: Prisma.TransactionClient = this.prismaService): Promise<TestVariation> {
    return tx.testVariation.create({
      data: {
        project: { connect: { id: data.projectId } },
        branchName: data.branchName,
        ...getTestVariationUniqueData(data),
      },
    });
  }

  async createOrTakeWinner(data: NewVariation): Promise<TestVariation> {
    try {
      return await this.create(data);
    } catch (e) {
      if (isPrismaError(e, 'P2002')) {
        const winner = await this.findUnique(variationKey(data.projectId, data.branchName, data));
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
      before,
    }: {
      id: string;
      userId?: string;
      testRunId: string;
      baselineName: string;
      before?: Pick<TestVariation, 'ignoreAreas' | 'comment'>;
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
            ...(before && { ignoreAreasBeforeApproval: before.ignoreAreas, commentBeforeApproval: before.comment }),
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
