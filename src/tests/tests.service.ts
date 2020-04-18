import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Test } from './test.entity';
import { CreateTestDto } from './dto/create-test.dto';

@Injectable()
export class TestsService {
  constructor(
    @InjectModel(Test)
    private testModel: typeof Test,
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
    // createTestDto.imageBase64

    test.name = createTestDto.name;
    test.os = createTestDto.os;
    test.browser = createTestDto.browser;
    test.viewport = createTestDto.viewport;
    test.device = createTestDto.device;
    test.status = 'new';
    test.buildId = createTestDto.buildId;

    if (lastSuccessTest) {
      test.baselineUrl = lastSuccessTest.baselineUrl;
      // get diff
      // test.diffUrl =

      // if there is diff
      test.status = 'unresolved';

      // if ther is NO diff
      test.status = 'ok';
    }

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
