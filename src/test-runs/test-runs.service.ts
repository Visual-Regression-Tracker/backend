import { Injectable } from '@nestjs/common';
import { PNG, PNGWithMetadata } from 'pngjs';
import Pixelmatch from 'pixelmatch';
import { CreateTestRequestDto } from '../test/dto/create-test-request.dto';
import { IgnoreAreaDto } from '../test/dto/ignore-area.dto';
import { StaticService } from '../shared/static/static.service';
import { PrismaService } from '../prisma/prisma.service';
import { TestRun, TestStatus, TestVariation } from '@prisma/client';
import { DiffResult } from './diffResult';

@Injectable()
export class TestRunsService {
  constructor(private prismaService: PrismaService, private staticService: StaticService) {}

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

  async approve(id: string): Promise<TestRun> {
    const testRun = await this.findOne(id);

    // save new baseline
    const baseline = this.staticService.getImage(testRun.imageName);
    const baselineName = this.staticService.saveImage('baseline', PNG.sync.write(baseline));

    return this.prismaService.testRun.update({
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
  }

  async reject(id: string): Promise<TestRun> {
    return this.prismaService.testRun.update({
      where: { id },
      data: {
        status: TestStatus.failed,
      },
    });
  }

  async create(testVariation: TestVariation, createTestRequestDto: CreateTestRequestDto): Promise<TestRun> {
    // save image
    const imageBuffer = Buffer.from(createTestRequestDto.imageBase64, 'base64');
    const imageName = this.staticService.saveImage('screenshot', imageBuffer);

    let diff: DiffResult;

    if (testVariation.baselineName) {
      let baseline: PNGWithMetadata;
      baseline = this.staticService.getImage(testVariation.baselineName);

      if (baseline) {
        const image = this.staticService.getImage(imageName);
        diff = this.getDiff(baseline, image, createTestRequestDto.diffTollerancePercent, testVariation.ignoreAreas);
      }
    }

    return this.prismaService.testRun.create({
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
        ignoreAreas: testVariation.ignoreAreas,
        diffTollerancePercent: createTestRequestDto.diffTollerancePercent,
        diffName: diff && diff.imageName,
        pixelMisMatchCount: diff && diff.pixelMisMatchCount,
        diffPercent: diff && diff.diffPercent,
        status: diff ? diff.status : TestStatus.new,
      },
    });
  }

  async delete(id: string): Promise<TestRun> {
    const testRun = await this.findOne(id);

    try {
      Promise.all([
        testRun.diffName && this.staticService.deleteImage(testRun.diffName),
        this.staticService.deleteImage(testRun.imageName),
      ]);
    } catch (err) {
      console.log(err);
    }

    return this.prismaService.testRun.delete({
      where: { id },
    });
  }

  async updateIgnoreAreas(id: string, ignoreAreas: IgnoreAreaDto[]): Promise<TestRun> {
    return this.prismaService.testRun.update({
      where: { id },
      data: {
        ignoreAreas: JSON.stringify(ignoreAreas),
      },
    });
  }

  getDiff(baseline: PNG, image: PNG, diffTollerancePercent: number, ignoreAreas: string): DiffResult {
    const result: DiffResult = {
      status: null,
      imageName: null,
      pixelMisMatchCount: null,
      diffPercent: null,
      isSameDimension: baseline.width === image.width && baseline.height === image.height,
    };

    if (result.isSameDimension) {
      const diff = new PNG({
        width: baseline.width,
        height: baseline.height,
      });

      // compare
      result.pixelMisMatchCount = Pixelmatch(
        this.applyIgnoreAreas(baseline, JSON.parse(ignoreAreas)),
        this.applyIgnoreAreas(image, JSON.parse(ignoreAreas)),
        diff.data,
        baseline.width,
        baseline.height,
        {
          threshold: diffTollerancePercent / 100,
          includeAA: true,
        }
      );
      result.diffPercent = (result.pixelMisMatchCount * 100) / (image.width * image.height);

      if (result.diffPercent > diffTollerancePercent) {
        // save diff
        result.imageName = this.staticService.saveImage('diff', PNG.sync.write(diff));
        result.status = TestStatus.unresolved;
      } else {
        result.status = TestStatus.ok;
      }
    } else {
      // diff dimensions
      result.status = TestStatus.unresolved;
    }
    return result;
  }

  private applyIgnoreAreas(image: PNG, ignoreAreas: IgnoreAreaDto[]): Buffer {
    ignoreAreas.forEach(area => {
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
