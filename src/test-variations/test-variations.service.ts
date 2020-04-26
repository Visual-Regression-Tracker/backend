import { Injectable } from '@nestjs/common';
import { TestVariation } from './testVariation.entity';
import { InjectModel } from '@nestjs/sequelize';
import { CreateTestRequestDto } from 'src/test/dto/create-test-request.dto';

@Injectable()
export class TestVariationsService {
  constructor(
    @InjectModel(TestVariation)
    private testVariationModel: typeof TestVariation,
  ) {}

  async findOrCreate(
    createTestDto: CreateTestRequestDto,
  ): Promise<[TestVariation, boolean]> {
    return this.testVariationModel.findOrCreate({
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
