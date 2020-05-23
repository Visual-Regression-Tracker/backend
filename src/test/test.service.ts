import { Injectable } from '@nestjs/common';
import { TestVariationsService } from '../test-variations/test-variations.service';
import { TestRunsService } from '../test-runs/test-runs.service';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { TestRunResultDto } from './dto/testRunResult.dto';

@Injectable()
export class TestService {
  constructor(
    private testVariationService: TestVariationsService,
    private testRunsService: TestRunsService,
  ) { }

  async postTestRun(createTestRequestDto: CreateTestRequestDto): Promise<TestRunResultDto> {
    const testVariation = await this.testVariationService.findOrCreate(createTestRequestDto);

    const testRun = await this.testRunsService.create(testVariation, createTestRequestDto);

    return new TestRunResultDto(testRun, testVariation);
  }
}
