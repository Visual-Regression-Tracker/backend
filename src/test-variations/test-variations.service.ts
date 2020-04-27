import { Injectable } from '@nestjs/common';
import { TestVariation } from './testVariation.entity';
import { InjectModel } from '@nestjs/sequelize';
import { CreateTestRequestDto } from 'src/test/dto/create-test-request.dto';
import { IgnoreAreaDto } from 'src/test/dto/ignore-area.dto';

@Injectable()
export class TestVariationsService {
  constructor(
    @InjectModel(TestVariation)
    private testVariationModel: typeof TestVariation,
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
}
