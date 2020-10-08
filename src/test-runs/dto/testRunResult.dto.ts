import { TestRun, TestStatus, TestVariation } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class TestRunResultDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  imageName: string;
  @ApiProperty()
  diffName?: string;
  @ApiProperty()
  baselineName?: string;
  @ApiProperty()
  diffPercent: number;
  @ApiProperty()
  diffTollerancePercent?: number;
  @ApiProperty()
  pixelMisMatchCount?: number;
  @ApiProperty()
  status: TestStatus;
  @ApiProperty()
  url: string;
  @ApiProperty()
  merge: boolean;

  constructor(testRun: TestRun, testVariation: TestVariation) {
    this.id = testRun.id;
    this.imageName = testRun.imageName;
    this.diffName = testRun.diffName;
    this.baselineName = testVariation.baselineName;
    this.diffPercent = testRun.diffPercent;
    this.diffTollerancePercent = testRun.diffTollerancePercent;
    this.pixelMisMatchCount = testRun.pixelMisMatchCount;
    this.status = testRun.status;
    this.merge = testRun.merge;
    this.url = `${process.env.APP_FRONTEND_URL}/${testVariation.projectId}?buildId=${testRun.buildId}&testId=${testRun.id}`;
  }
}
