import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Test } from './test.entity';
import { CreateTestDto } from './dto/create-test.dto';
import { ConfigService } from 'src/shared/config/config.service';
import { writeFile } from 'fs';
import { resolve } from 'path';

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
    const imageName = `${Date.now()}.${createTestDto.name}.screenshot.png`
    await writeFile(
      resolve(
        this.configService.imgConfig.uploadPath,
        imageName,
      ),
      Buffer.from(createTestDto.imageBase64, 'base64'),
      err => {
        return err;
      },
    );

    if (lastSuccessTest) {
      test.baselineUrl = lastSuccessTest.baselineUrl;
      // get diff
      // test.diffUrl =

      // if there is diff
      test.status = 'unresolved';

      // if ther is NO diff
      test.status = 'ok';
    } else {
      test.status = 'new';
    }

    test.imageUrl = imageName
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
      },
    });
  }
}
