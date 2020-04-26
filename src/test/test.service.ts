import { Injectable } from '@nestjs/common';
import { TestVariationsService } from 'src/test-variations/test-variations.service';
import { TestRunsService } from 'src/test-runs/test-runs.service';
import { TestRunDto } from './dto/test-run.dto';
import { CreateTestRequestDto } from './dto/create-test-request.dto';

@Injectable()
export class TestService {
  constructor(
    private testVariationService: TestVariationsService,
    private testRunsService: TestRunsService,
  ) {}

  async getTestRunsByBuildId(buildId: string): Promise<TestRunDto[]> {
    const testRuns = await this.testRunsService.getAllByBuildId(buildId);

    return testRuns.map(testRun => new TestRunDto(testRun));
  }

  async postTestRunResult(
    createTestRequestDto: CreateTestRequestDto,
  ): Promise<TestRunDto> {
    const [testVariation] = await this.testVariationService.findOrCreate(
      createTestRequestDto,
    );

    const testRun = await this.testRunsService.create(
      testVariation,
      createTestRequestDto,
    );

    const testRunDetails = await this.testRunsService.findOne(testRun.id);
    return new TestRunDto(testRunDetails);
  }
}
