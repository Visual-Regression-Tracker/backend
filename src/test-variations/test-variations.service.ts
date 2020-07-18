import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { IgnoreAreaDto } from '../test-runs/dto/ignore-area.dto';
import { PrismaService } from '../prisma/prisma.service';
import { TestVariation, Baseline, Project, Build, TestRun } from '@prisma/client';
import { StaticService } from '../shared/static/static.service';
import { CommentDto } from '../shared/dto/comment.dto';
import { BaselineDataDto, convertBaselineDataToQuery } from '../shared/dto/baseline-data.dto';
import { BuildsService } from '../builds/builds.service';
import { TestRunsService } from '../test-runs/test-runs.service';
import { PNG } from 'pngjs';
import { CreateTestRequestDto } from 'src/test-runs/dto/create-test-request.dto';
import { BuildDto } from 'src/builds/dto/build.dto';

@Injectable()
export class TestVariationsService {
  constructor(
    private prismaService: PrismaService,
    private staticService: StaticService,
    @Inject(forwardRef(() => BuildsService))
    private buildsService: BuildsService,
    @Inject(forwardRef(() => TestRunsService))
    private testRunsService: TestRunsService
  ) {}

  async getDetails(id: string): Promise<TestVariation & { baselines: Baseline[] }> {
    return this.prismaService.testVariation.findOne({
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
    const project = await this.prismaService.project.findOne({ where: { id: projectId } });

    let [[mainBranchTestVariation], [currentBranchTestVariation]] = await Promise.all([
      // search main branch variation
      this.prismaService.testVariation.findMany({
        where: {
          projectId,
          name: baselineData.name,
          os: baselineData.os,
          device: baselineData.device,
          browser: baselineData.browser,
          viewport: baselineData.viewport,
          branchName: project.mainBranchName,
        },
      }),
      // search current branch variation
      this.prismaService.testVariation.findMany({
        where: {
          projectId,
          ...baselineData,
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

  async remove(id: string): Promise<TestVariation> {
    const variation = await this.getDetails(id);

    // clear history
    try {
      await Promise.all(
        variation.baselines.map(baseline =>
          Promise.all([
            this.staticService.deleteImage(baseline.baselineName),
            this.prismaService.baseline.delete({
              where: { id: baseline.id },
            }),
          ])
        )
      );
    } catch (err) {
      console.log(err);
    }

    return this.prismaService.testVariation.delete({
      where: { id },
    });
  }

  async merge(projectId: string, branchName: string): Promise<BuildDto> {
    const project: Project = await this.prismaService.project.findOne({ where: { id: projectId } });

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
    testVariations.map(async sideBranchTestVariation => {
      const baseline = this.staticService.getImage(sideBranchTestVariation.baselineName);
      if (baseline) {
        try {
          let imageBase64 = PNG.sync.write(baseline).toString('base64');

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
          };

          return this.testRunsService.create(mainBranchTestVariation, createTestRequestDto);
        } catch (err) {
          console.log(err);
        }
      }
    });

    return build;
  }

  async delete(id: string): Promise<TestVariation> {
    const [testVariation, testRuns] = await Promise.all([
      this.getDetails(id),
      this.prismaService.testRun.findMany({
        where: { testVariationId: id },
      })
    ])

    // delete testRun
    await Promise.all(testRuns.map(item => this.testRunsService.delete(item.id)));
    
    // delete baseline
    await Promise.all(testVariation.baselines.map(baseline => this.deleteBaseline(baseline)));

    // delete testVariation
    return this.prismaService.testVariation.delete({
      where: { id },
    });
  }

  private async deleteBaseline(baseline: Baseline): Promise<Baseline> {
    this.staticService.deleteImage(baseline.baselineName);
    return this.prismaService.baseline.delete({
      where: { id: baseline.id },
    });
  }
}
