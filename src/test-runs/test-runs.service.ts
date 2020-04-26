import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { TestRun } from './testRun.entity';
import { PNG } from 'pngjs';
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { TestStatus } from 'src/tests/test.status';
import { ConfigService } from 'src/shared/config/config.service';
import Pixelmatch from 'Pixelmatch';
import { IgnoreArea } from 'src/tests/ignoreArea.entity';
import { Test } from 'src/tests/test.entity';
import { TestVariation } from 'src/test-variations/testVariation.entity';
import { CreateTestRequestDto } from 'src/test/dto/create-test-request.dto';

@Injectable()
export class TestRunsService {
  constructor(
    @InjectModel(TestRun)
    private testRunModel: typeof TestRun,
    private configService: ConfigService,
  ) {}

  async getAllByBuildId(buildId: string): Promise<TestRun[]> {
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

  async create(testVariation: TestVariation, createTestRequestDto: CreateTestRequestDto): Promise<TestRun> {
    // save image
    const imageBuffer = Buffer.from(createTestRequestDto.imageBase64, 'base64');
    const imageName = `${Date.now()}.screenshot.png`;
    const image = PNG.sync.read(imageBuffer);
    writeFileSync(
      resolve(this.configService.imgConfig.uploadPath, imageName),
      imageBuffer,
    );

    // create test run
    const testRun = new TestRun();
    testRun.imageName = imageName;
    testRun.testVariationId = testVariation.id;
    testRun.buildId = createTestRequestDto.buildId;

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
          threshold: 0.1,
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

      if (pixelMisMatchCount > 0) {
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

  private applyIgnoreAreas(image: PNG, ignoreAreas: IgnoreArea[]): Buffer {
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
