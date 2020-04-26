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

@Injectable()
export class TestRunsService {
  constructor(
    // @InjectModel(TestRun)
    // private testRunModel: typeof TestRun,
    private configService: ConfigService,
  ) {}

  async create(test: Test, buildId: string, imageBase64: string): Promise<TestRun> {
    // save image
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const imageName = `${Date.now()}.screenshot.png`;
    const image = PNG.sync.read(imageBuffer);
    writeFileSync(
      resolve(this.configService.imgConfig.uploadPath, imageName),
      imageBuffer,
    );

    // create test run
    const testRun = new TestRun();
    testRun.imageUrl = imageName;
    testRun.testVariationId = test.id;
    testRun.buildId = buildId;

    // compare with baseline
    if (test.baselineUrl) {
      const baseline = PNG.sync.read(
        readFileSync(resolve(this.configService.imgConfig.uploadPath, test.baselineUrl)),
      );

      const diffImageKey = `${Date.now()}.diff.png`;
      const diff = new PNG({
        width: baseline.width,
        height: baseline.height,
      });

      // compare
      const pixelMisMatchCount = Pixelmatch(
        this.applyIgnoreAreas(baseline, test.ignoreAreas),
        this.applyIgnoreAreas(image, test.ignoreAreas),
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
      testRun.diffUrl = diffImageKey;
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
