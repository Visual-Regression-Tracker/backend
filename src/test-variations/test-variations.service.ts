import { Injectable } from '@nestjs/common';
import { TestVariation } from './testVariation.entity';
import { InjectModel } from '@nestjs/sequelize';
import { CreateTestRequestDto } from 'src/test/dto/create-test-request.dto';
import { IgnoreAreaDto } from 'src/test/dto/ignore-area.dto';
import { TestRun } from 'src/test-runs/testRun.entity';
import { TestRunsService } from 'src/test-runs/test-runs.service';
import { StaticService } from 'src/shared/static/static.service';

@Injectable()
export class TestVariationsService {
  constructor(
    @InjectModel(TestVariation)
    private testVariationModel: typeof TestVariation,
    private testRunsService: TestRunsService,
    private staticService: StaticService,
  ) {}

  async findOrCreate(createTestDto: CreateTestRequestDto): Promise<[TestVariation, boolean]> {
    return this.testVariationModel.findOrCreate({
      where: {
        projectId: createTestDto.projectId,
        name: createTestDto.name,
        os: createTestDto.os ? createTestDto.os : null,
        browser: createTestDto.browser ? createTestDto.browser : null,
        viewport: createTestDto.viewport ? createTestDto.viewport : null,
        device: createTestDto.device ? createTestDto.device : null,
      },
    });
  }

  async updateIgnoreAreas(
    id: string,
    ignoreAreas: IgnoreAreaDto[],
  ): Promise<[number, TestVariation[]]> {
    return this.testVariationModel.update(
      {
        ignoreAreas,
      },
      {
        where: { id },
      },
    );
  }

  async remove(id: string): Promise<number> {
    const testVariation = await this.testVariationModel.findOne({
      where: { id },
      include: [TestRun],
    });

    try {
      await Promise.all(
        testVariation.testRuns.map(testRun => this.testRunsService.delete(testRun.id)),
      );
      if (testVariation.baselineName) this.staticService.deleteImage(testVariation.baselineName);
    } catch (err) {
      console.log(err);
    }

    return this.testVariationModel.destroy({
      where: { id },
    });
  }
}
