import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { IgnoreAreaDto } from '../test-runs/dto/ignore-area.dto';
import { PrismaService } from '../prisma/prisma.service';
import { TestVariation, Baseline, Project } from '@prisma/client';
import { StaticService } from '../shared/static/static.service';
import { CommentDto } from '../shared/dto/comment.dto';
import { BaselineDataDto, convertBaselineDataToQuery } from '../shared/dto/baseline-data.dto';
import { BuildsService } from '../builds/builds.service';
import { TestRunsService } from '../test-runs/test-runs.service';
import { PNG } from 'pngjs';
import { CreateTestRequestDto } from 'src/test-runs/dto/create-test-request.dto';
import { BuildDto } from 'src/builds/dto/build.dto';
import { getTestVariationUniqueData } from '../utils';

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

  async findOrCreate(projectId: string, baselineData: BaselineDataDto): Promise<TestVariation> {
    const project = await this.prismaService.project.findUnique({ where: { id: projectId } });

    const [mainBranchTestVariation, currentBranchTestVariation] = await Promise.all([
      // search main branch variation
      this.prismaService.testVariation.findUnique({
        where: {
          projectId_name_browser_device_os_viewport_branchName: {
            projectId,
            branchName: project.mainBranchName,
            ...getTestVariationUniqueData(baselineData),
          },
        },
      }),
      // search current branch variation
      this.prismaService.testVariation.findUnique({
        where: {
          projectId_name_browser_device_os_viewport_branchName: {
            projectId,
            branchName: baselineData.branchName,
            ...getTestVariationUniqueData(baselineData),
          },
        },
      }),
    ]);

    if (!!currentBranchTestVariation) {
      return currentBranchTestVariation;
    }
    if (!!mainBranchTestVariation) {
      return mainBranchTestVariation;
    }
    return this.prismaService.testVariation.create({
      data: {
        project: { connect: { id: projectId } },
        ...baselineData,
      },
    });
  }

  async updateIgnoreAreas(id: string, ignoreAreas: IgnoreAreaDto[]): Promise<TestVariation> {
    return this.prismaService.testVariation.update({
      where: { id },
      data: {
        ignoreAreas: JSON.stringify(ignoreAreas),
      },
    });
  }

  async updateComment(id: string, commentDto: CommentDto): Promise<TestVariation> {
    return this.prismaService.testVariation.update({
      where: { id },
      data: {
        comment: commentDto.comment,
      },
    });
  }

  async merge(projectId: string, branchName: string): Promise<BuildDto> {
    const project: Project = await this.prismaService.project.findUnique({ where: { id: projectId } });

    // create build
    const build: BuildDto = await this.buildsService.create({
      branchName: project.mainBranchName,
      project: projectId,
    });

    // find side branch variations
    const testVariations: TestVariation[] = await this.prismaService.testVariation.findMany({
      where: { projectId, branchName },
    });

    // compare to main branch variations
    testVariations.map(async (sideBranchTestVariation) => {
      const baseline = this.staticService.getImage(sideBranchTestVariation.baselineName);
      if (baseline) {
        try {
          const imageBase64 = PNG.sync.write(baseline).toString('base64');

          // get main branch variation
          const baselineData = convertBaselineDataToQuery({
            ...sideBranchTestVariation,
            branchName: project.mainBranchName,
          });
          const mainBranchTestVariation = await this.findOrCreate(projectId, baselineData);

          // get side branch request
          const createTestRequestDto: CreateTestRequestDto = {
            ...sideBranchTestVariation,
            buildId: build.id,
            imageBase64,
            diffTollerancePercent: 0,
            merge: true,
            ignoreAreas: JSON.parse(sideBranchTestVariation.ignoreAreas),
          };

          return this.testRunsService.create(mainBranchTestVariation, createTestRequestDto);
        } catch (err) {
          console.log(err);
        }
      }
    });

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
