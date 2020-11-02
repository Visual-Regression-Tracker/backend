import { Injectable } from '@nestjs/common';
import { PNG } from 'pngjs';
import Pixelmatch from 'pixelmatch';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { IgnoreAreaDto } from './dto/ignore-area.dto';
import { StaticService } from '../shared/static/static.service';
import { PrismaService } from '../prisma/prisma.service';
import { TestRun, TestStatus, TestVariation } from '@prisma/client';
import { DiffResult } from './diffResult';
import { EventsGateway } from '../shared/events/events.gateway';
import { CommentDto } from '../shared/dto/comment.dto';
import { BuildDto } from '../builds/dto/build.dto';
import { TestRunResultDto } from '../test-runs/dto/testRunResult.dto';
import { TestVariationsService } from '../test-variations/test-variations.service';
import { convertBaselineDataToQuery } from '../shared/dto/baseline-data.dto';

@Injectable()
export class TestRunsService {
  constructor(
    private testVariationService: TestVariationsService,
    private prismaService: PrismaService,
    private staticService: StaticService,
    private eventsGateway: EventsGateway
  ) {}

  async findMany(buildId: string): Promise<TestRun[]> {
    return this.prismaService.testRun.findMany({
      where: { buildId },
    });
  }

  async findOne(
    id: string
  ): Promise<
    TestRun & {
      testVariation: TestVariation;
    }
  > {
    return this.prismaService.testRun.findOne({
      where: { id },
      include: {
        testVariation: true,
      },
    });
  }

  async postTestRun(createTestRequestDto: CreateTestRequestDto): Promise<TestRunResultDto> {
    const baselineData = convertBaselineDataToQuery(createTestRequestDto);

    // creates variatioin if does not exist
    const testVariation = await this.testVariationService.findOrCreate(createTestRequestDto.projectId, baselineData);

    // delete previous test run if exists
    let [previousTestRun] = await this.prismaService.testRun.findMany({
      where: {
        buildId: createTestRequestDto.buildId,
        ...baselineData,
      },
    });

    if (!!previousTestRun) {
      await this.delete(previousTestRun.id);
    }

    // create test run result
    const testRun = await this.create(testVariation, createTestRequestDto);

    return new TestRunResultDto(testRun, testVariation);
  }

  async emitUpdateBuildEvent(buildId: string) {
    const build = await this.prismaService.build.findOne({
      where: {
        id: buildId,
      },
      include: {
        testRuns: true,
      },
    });
    const buildDto = new BuildDto(build);
    this.eventsGateway.buildUpdated(buildDto);
  }

  async approve(id: string, merge: boolean): Promise<TestRun> {
    const testRun = await this.findOne(id);

    // save new baseline
    const baseline = this.staticService.getImage(testRun.imageName);
    const baselineName = this.staticService.saveImage('baseline', PNG.sync.write(baseline));
    let testRunUpdated: TestRun;
    if (merge || testRun.branchName === testRun.baselineBranchName) {
      testRunUpdated = await this.prismaService.testRun.update({
        where: { id },
        data: {
          status: TestStatus.approved,
          testVariation: {
            update: {
              baselineName,
              baselines: {
                create: {
                  baselineName,
                  testRun: {
                    connect: {
                      id: testRun.id,
                    },
                  },
                },
              },
            },
          },
        },
      });
    } else {
      const newTestVariation = await this.prismaService.testVariation.create({
        data: {
          project: { connect: { id: testRun.testVariation.projectId } },
          baselineName,
          name: testRun.name,
          browser: testRun.browser,
          device: testRun.device,
          os: testRun.os,
          viewport: testRun.viewport,
          ignoreAreas: testRun.ignoreAreas,
          comment: testRun.comment,
          branchName: testRun.branchName,
        },
      });
      const newBaseline = await this.prismaService.baseline.create({
        data: {
          baselineName,
          testVariation: {
            connect: { id: newTestVariation.id },
          },
          testRun: {
            connect: {
              id: testRun.id,
            },
          },
        },
      });
      testRunUpdated = await this.prismaService.testRun.update({
        where: { id },
        data: {
          status: TestStatus.approved,
          testVariation: {
            connect: { id: newTestVariation.id },
          },
        },
      });
    }

    this.emitUpdateBuildEvent(testRun.buildId);
    return testRunUpdated;
  }

  async reject(id: string): Promise<TestRun> {
    const testRun = await this.prismaService.testRun.update({
      where: { id },
      data: {
        status: TestStatus.failed,
      },
    });

    this.emitUpdateBuildEvent(testRun.buildId);
    return testRun;
  }

  async saveDiffResult(id: string, diffResult: DiffResult): Promise<TestRun> {
    return this.prismaService.testRun.update({
      where: { id },
      data: {
        diffName: diffResult && diffResult.diffName,
        pixelMisMatchCount: diffResult && diffResult.pixelMisMatchCount,
        diffPercent: diffResult && diffResult.diffPercent,
        status: diffResult ? diffResult.status : TestStatus.new,
      },
    });
  }

  async recalculateDiff(id: string): Promise<TestRun> {
    const testRun = await this.findOne(id);

    const baseline = this.staticService.getImage(testRun.baselineName);
    const image = this.staticService.getImage(testRun.imageName);
    await this.staticService.deleteImage(testRun.diffName);

    const diffResult = this.getDiff(baseline, image, testRun.diffTollerancePercent, JSON.parse(testRun.ignoreAreas));
    const updatedTestRun = await this.saveDiffResult(id, diffResult);
    this.emitUpdateBuildEvent(testRun.buildId);
    return updatedTestRun;
  }

  async create(testVariation: TestVariation, createTestRequestDto: CreateTestRequestDto): Promise<TestRun> {
    // save image
    const imageBuffer = Buffer.from(createTestRequestDto.imageBase64, 'base64');
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
        name: testVariation.name,
        browser: testVariation.browser,
        device: testVariation.device,
        os: testVariation.os,
        viewport: testVariation.viewport,
        baselineName: testVariation.baselineName,
        baselineBranchName: testVariation.branchName,
        ignoreAreas: testVariation.ignoreAreas,
        comment: testVariation.comment,
        diffTollerancePercent: createTestRequestDto.diffTollerancePercent,
        branchName: createTestRequestDto.branchName,
        merge: createTestRequestDto.merge,
        status: TestStatus.new,
      },
    });

    const baseline = this.staticService.getImage(testRun.baselineName);
    const image = this.staticService.getImage(imageName);

    let ignoreAreas: IgnoreAreaDto[] = JSON.parse(testVariation.ignoreAreas);
    if (createTestRequestDto.ignoreAreas?.length > 0) {
      ignoreAreas = ignoreAreas.concat(createTestRequestDto.ignoreAreas);
    }
    const diffResult = this.getDiff(baseline, image, testRun.diffTollerancePercent, ignoreAreas);

    const testRunWithResult = await this.saveDiffResult(testRun.id, diffResult);
    this.eventsGateway.testRunCreated(testRunWithResult);
    return testRunWithResult;
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
    return this.prismaService.testRun.update({
      where: { id },
      data: {
        ignoreAreas: JSON.stringify(ignoreAreas),
      },
    });
  }

  async updateComment(id: string, commentDto: CommentDto): Promise<TestRun> {
    return this.prismaService.testRun.update({
      where: { id },
      data: {
        comment: commentDto.comment,
      },
    });
  }

  getDiff(baseline: PNG, image: PNG, diffTollerancePercent: number, ignoreAreas: IgnoreAreaDto[]): DiffResult {
    const result: DiffResult = {
      status: undefined,
      diffName: null,
      pixelMisMatchCount: undefined,
      diffPercent: undefined,
      isSameDimension: undefined,
    };

    if (baseline) {
      result.isSameDimension = baseline.width === image.width && baseline.height === image.height;

      if (result.isSameDimension) {
        const diff = new PNG({
          width: baseline.width,
          height: baseline.height,
        });

        // compare
        result.pixelMisMatchCount = Pixelmatch(
          this.applyIgnoreAreas(baseline, ignoreAreas),
          this.applyIgnoreAreas(image, ignoreAreas),
          diff.data,
          baseline.width,
          baseline.height,
          {
            includeAA: true,
          }
        );
        result.diffPercent = (result.pixelMisMatchCount * 100) / (image.width * image.height);

        if (result.diffPercent > diffTollerancePercent) {
          // save diff
          result.diffName = this.staticService.saveImage('diff', PNG.sync.write(diff));
          result.status = TestStatus.unresolved;
        } else {
          result.status = TestStatus.ok;
        }
      } else {
        // diff dimensions
        result.status = TestStatus.unresolved;
      }
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
}
