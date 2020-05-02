import { Injectable } from '@nestjs/common';
import { TestVariationsService } from 'src/test-variations/test-variations.service';
import { TestRunsService } from 'src/test-runs/test-runs.service';
import { CreateTestRequestDto } from './dto/create-test-request.dto';
import { IgnoreAreaDto } from './dto/ignore-area.dto';
import { TestVariationDto } from './dto/test-variation.dto';
import { TestRun, TestVariation } from '@prisma/client';

@Injectable()
export class TestService {
  constructor(
    private testVariationService: TestVariationsService,
    private testRunsService: TestRunsService,
  ) {}

  async getTestRunsByBuildId(buildId: string): Promise<TestRun[]> {

    return this.testRunsService.getAll(buildId);
  }

  async getTestRunById(testRunId: string): Promise<TestRun> {
    return this.testRunsService.findOne(testRunId);
  }

  async postTestRun(createTestRequestDto: CreateTestRequestDto): Promise<TestRun> {
    const testVariation = await this.testVariationService.findOrCreate(createTestRequestDto);

    const testRun = await this.testRunsService.create(testVariation, createTestRequestDto);

    return this.testRunsService.findOne(testRun.id);
  }

  async deleteTestRun(id: string): Promise<TestRun> {
    return this.testRunsService.delete(id);
  }

  async approveTestRun(testRunId: string): Promise<TestRun> {
    return this.testRunsService.approve(testRunId);
  }

  async rejectTestRun(testRunId: string): Promise<TestRun> {
    return this.testRunsService.reject(testRunId);
  }

  async updateIgnoreAreas(
    testRunId: string,
    ignoreAreas: IgnoreAreaDto[],
  ): Promise<TestVariation> {
    return this.testVariationService.updateIgnoreAreas(testRunId, ignoreAreas);
  }
}
