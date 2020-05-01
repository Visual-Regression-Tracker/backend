import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { TestRun } from './testRun.entity';
import { PNG } from 'pngjs';
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { TestStatus } from 'src/test-runs/test.status';
import { ConfigService } from 'src/shared/config/config.service';
import Pixelmatch from 'Pixelmatch';
import { TestVariation } from 'src/test-variations/testVariation.entity';
import { CreateTestRequestDto } from 'src/test/dto/create-test-request.dto';
import { TestRunDto } from 'src/test/dto/test-run.dto';
import { IgnoreAreaDto } from 'src/test/dto/ignore-area.dto';

@Injectable()
export class TestRunsService {
  constructor(
    @InjectModel(TestRun)
    private testRunModel: typeof TestRun,
    private configService: ConfigService,
  ) {}

  async getAll(buildId: string): Promise<TestRun[]> {
    return this.testRunModel.findAll({
      where: { buildId },
      include: [TestVariation],
      order: [['createdAt', 'DESC']],
    });
  }

  async findOne(id: string): Promise<TestRun> {
    return this.testRunModel.findOne({
      where: { id },
      include: [TestVariation],
    });
  }

  async approve(id: string): Promise<TestRunDto> {
    const testRun = await this.findOne(id);
    testRun.status = TestStatus.ok;
    testRun.testVariation.baselineName = testRun.imageName;

    const [testData] = await Promise.all([testRun.save(), testRun.testVariation.save()]);

    return new TestRunDto(testData);
  }

  async reject(id: string): Promise<TestRunDto> {
    const testRun = await this.findOne(id);
    testRun.status = TestStatus.failed;

    const testData = await testRun.save();
    return new TestRunDto(testData);
  }

  async create(
    testVariation: TestVariation,
    createTestRequestDto: CreateTestRequestDto,
  ): Promise<TestRun> {
    // save image
    const imageBuffer = Buffer.from(createTestRequestDto.imageBase64, 'base64');
    const imageName = `${Date.now()}.screenshot.png`;
    const image = PNG.sync.read(imageBuffer);
    writeFileSync(resolve(this.configService.imgConfig.uploadPath, imageName), imageBuffer);

    // create test run
    const testRun = new TestRun();
    testRun.imageName = imageName;
    testRun.testVariationId = testVariation.id;
    testRun.buildId = createTestRequestDto.buildId;
    testRun.diffTollerancePercent = createTestRequestDto.diffTollerancePercent;

    // compare with baseline
    if (testVariation.baselineName) {
      const baseline = PNG.sync.read(
        readFileSync(resolve(this.configService.imgConfig.uploadPath, testVariation.baselineName)),
      );

      const diffImageKey = `${Date.now()}.diff.png`;
      const diff = new PNG({
        width: baseline.width,
        height: baseline.height,
      });

      // compare
      const pixelMisMatchCount = Pixelmatch(
        this.applyIgnoreAreas(baseline, testVariation.ignoreAreas),
        this.applyIgnoreAreas(image, testVariation.ignoreAreas),
        diff.data,
        baseline.width,
        baseline.height,
        {
          threshold: testRun.diffTollerancePercent / 100,
          includeAA: true,
        },
      );

      // save diff
      writeFileSync(
        resolve(this.configService.imgConfig.uploadPath, diffImageKey),
        PNG.sync.write(diff),
      );
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
    return await testRun.save();
  }

  async delete(id: string): Promise<number> {
    return this.testRunModel.destroy({
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
