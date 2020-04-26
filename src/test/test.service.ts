import { Injectable } from '@nestjs/common';
import { TestVariationsService } from 'src/test-variations/test-variations.service';
import { TestRunsService } from 'src/test-runs/test-runs.service';
import { TestRunDto } from './dto/test-run.dto';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { IgnoreAreaDto } from './dto/ignore-area.dto';
import { TestVariationDto } from './dto/test-variation.dto';

@Injectable()
export class TestService {
  constructor(
    private testVariationService: TestVariationsService,
    private testRunsService: TestRunsService,
  ) {}

  async getTestRunsByBuildId(buildId: string): Promise<TestRunDto[]> {
    const testRuns = await this.testRunsService.getAll(buildId);

    return testRuns.map(testRun => new TestRunDto(testRun));
  }

  async getTestRunById(testRunId: string): Promise<TestRunDto> {
    const testRun = await this.testRunsService.findOne(testRunId);

    return new TestRunDto(testRun);
  }

  async postTestRun(createTestRequestDto: CreateTestRequestDto): Promise<TestRunDto> {
    const [testVariation] = await this.testVariationService.findOrCreate(createTestRequestDto);

    const testRun = await this.testRunsService.create(testVariation, createTestRequestDto);

    const testRunDetails = await this.testRunsService.findOne(testRun.id);
    return new TestRunDto(testRunDetails);
  }

  async deleteTestRun(id: string): Promise<number> {
    return this.testRunsService.delete(id);
  }

  async approveTestRun(testRunId: string): Promise<TestRunDto> {
    return this.testRunsService.approve(testRunId);
  }

  async rejectTestRun(testRunId: string): Promise<TestRunDto> {
    return this.testRunsService.reject(testRunId);
  }

  async updateIgnoreAreas(
    testRunId: string,
    ignoreAreas: IgnoreAreaDto[],
  ): Promise<[number, TestVariationDto[]]> {
    return this.testVariationService.updateIgnoreAreas(testRunId, ignoreAreas);
  }
}
