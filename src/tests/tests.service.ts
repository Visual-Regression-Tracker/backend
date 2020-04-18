import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Test } from './test.entity';
import { CreateTestDto } from './dto/create-test.dto';
import { ConfigService } from 'src/shared/config/config.service';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { PNG } from 'pngjs';
import { Op } from 'sequelize';
import Pixelmatch from 'Pixelmatch';

@Injectable()
export class TestsService {
  constructor(
    @InjectModel(Test)
    private testModel: typeof Test,
    private configService: ConfigService,
  ) {}

  async findAll(buildId: number): Promise<Test[]> {
    return this.testModel.findAll({
      where: { buildId },
    });
  }

  async create(createTestDto: CreateTestDto): Promise<Test> {
    const lastSuccessTest = await this.findLastSuccessfull(createTestDto);
    const test = new Test();

    // save image
    const imageBuffer = Buffer.from(createTestDto.imageBase64, 'base64');
    const imageName = `${Date.now()}.${createTestDto.name}.screenshot.png`;
    const image = PNG.sync.read(imageBuffer);
    writeFileSync(
      resolve(this.configService.imgConfig.uploadPath, imageName),
      imageBuffer,
    );

    if (lastSuccessTest) {
      // get latest baseline
      test.baselineUrl = lastSuccessTest.baselineUrl;

      if (test.baselineUrl) {
        const baseline = PNG.sync.read(
          readFileSync(
            resolve(this.configService.imgConfig.uploadPath, lastSuccessTest.baselineUrl),
          ),
        );

        const diffImageKey = `${Date.now()}.${createTestDto.name}.diff.png`;
        const diff = new PNG({
          width: baseline.width,
          height: baseline.height,
        });

        // compare
        const pixelMisMatchCount = Pixelmatch(
          baseline.data,
          image.data,
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
        test.diffUrl = diffImageKey;

        if (pixelMisMatchCount > 0) {
          // if there is diff
          test.status = 'unresolved';
        } else {
          // if ther is NO diff
          test.status = 'ok';
        }
      }
    } else {
      test.status = 'new';
    }

    test.imageUrl = imageName;
    test.name = createTestDto.name;
    test.os = createTestDto.os;
    test.browser = createTestDto.browser;
    test.viewport = createTestDto.viewport;
    test.device = createTestDto.device;
    test.buildId = createTestDto.buildId;

    return test.save();
  }

  async findLastSuccessfull(createTestDto: CreateTestDto): Promise<Test> {
    return this.testModel.findOne({
      where: {
        name: createTestDto.name,
        os: createTestDto.os,
        browser: createTestDto.browser,
        viewport: createTestDto.viewport,
        device: createTestDto.device,
        baselineUrl: { [Op.ne]: null },
      },
      order: [['createdAt', 'DESC']],
    });
  }
}
