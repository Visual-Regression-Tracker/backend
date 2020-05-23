import { Injectable } from '@nestjs/common';
import { PNG, PNGWithMetadata } from 'pngjs';
import Pixelmatch from 'pixelmatch';
import { CreateTestRequestDto } from 'src/test/dto/create-test-request.dto';
import { IgnoreAreaDto } from 'src/test/dto/ignore-area.dto';
import { StaticService } from 'src/shared/static/static.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { TestRun, TestStatus, TestVariation, TestRunCreateInput } from '@prisma/client';

@Injectable()
export class TestRunsService {
  constructor(private prismaService: PrismaService, private staticService: StaticService) { }

  async getAll(buildId: string): Promise<(TestRun & {
    testVariation: TestVariation;
  })[]> {
    return this.prismaService.testRun.findMany({
      where: { buildId },
      include: {
        testVariation: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async findOne(id: string): Promise<TestRun & {
    testVariation: TestVariation;
  }> {
    return this.prismaService.testRun.findOne({
      where: { id },
      include: {
        testVariation: true,
      },
    });
  }

  async approve(id: string): Promise<TestRun & {
    testVariation: TestVariation;
  }> {
    const testRun = await this.findOne(id);

    // remove old baseline
    if (testRun.testVariation.baselineName) {
      this.staticService.deleteImage(testRun.testVariation.baselineName);
    }

    // save new baseline
    const baseline = this.staticService.getImage(testRun.imageName)
    const imageName = `${Date.now()}.baseline.png`;
    this.staticService.saveImage(imageName, PNG.sync.write(baseline));

    return this.prismaService.testRun.update({
      where: { id },
      include: {
        testVariation: true,
      },
      data: {
        status: TestStatus.ok,
        testVariation: {
          update: {
            baselineName: imageName,
          },
        },
      },
    });
  }

  async reject(id: string): Promise<TestRun & {
    testVariation: TestVariation;
  }> {
    return this.prismaService.testRun.update({
      where: { id },
      include: {
        testVariation: true,
      },
      data: {
        status: TestStatus.failed,
      },
    });;
  }

  async create(
    testVariation: TestVariation,
    createTestRequestDto: CreateTestRequestDto,
  ): Promise<TestRun> {
    // save image
    const imageBuffer = Buffer.from(createTestRequestDto.imageBase64, 'base64');
    const imageName = `${Date.now()}.screenshot.png`;
    const image = PNG.sync.read(imageBuffer);
    this.staticService.saveImage(imageName, imageBuffer);

    // create test run
    const testRun: TestRunCreateInput = {
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
      status: TestStatus.new,
    };

    // get baseline image
    let baseline: PNGWithMetadata
    if (testRun.baselineName) {
      try {
        baseline = this.staticService.getImage(testRun.baselineName)
      } catch (ex) {
        console.log(`Cannot load baseline image: ${testRun.baselineName}. ${ex}`)
      }
    }

    // compare with baseline
    if (baseline) {
      const diffImageKey = `${Date.now()}.diff.png`;
      const diff = new PNG({
        width: baseline.width,
        height: baseline.height,
      });

      // compare
      const pixelMisMatchCount = Pixelmatch(
        this.applyIgnoreAreas(baseline, JSON.parse(testRun.ignoreAreas)),
        this.applyIgnoreAreas(image, JSON.parse(testRun.ignoreAreas)),
        diff.data,
        baseline.width,
        baseline.height,
        {
          threshold: testRun.diffTollerancePercent / 100,
          includeAA: true,
        },
      );

      // save diff
      this.staticService.saveImage(diffImageKey, PNG.sync.write(diff));
      testRun.diffName = diffImageKey;
      testRun.pixelMisMatchCount = pixelMisMatchCount;
      testRun.diffPercent = (pixelMisMatchCount * 100) / (image.width * image.height);

      if (testRun.diffPercent > testRun.diffTollerancePercent) {
        // if there is diff
        testRun.status = TestStatus.unresolved;
      } else {
        // if ther is NO diff
        testRun.status = TestStatus.ok;
      }
    } else {
      // no baseline
      testRun.status = TestStatus.new;
    }
    return this.prismaService.testRun.create({
      data: testRun,
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
