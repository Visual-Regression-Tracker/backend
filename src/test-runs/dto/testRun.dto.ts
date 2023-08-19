import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TestRun, TestStatus } from '@prisma/client';

export class TestRunDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  buildId: string;
  @ApiProperty()
  imageName: string;
  @ApiProperty()
  diffName: string;
  @ApiProperty()
  diffPercent: number;
  @ApiProperty()
  diffTollerancePercent: number;
  @ApiProperty()
  status: TestStatus;
  @ApiProperty()
  testVariationId: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  baselineName: string;
  @ApiProperty()
  os: string;
  @ApiProperty()
  browser: string;
  @ApiProperty()
  viewport: string;
  @ApiProperty()
  device: string;
  @ApiProperty()
  customTags: string;
  @ApiProperty()
  ignoreAreas: string;
  @ApiProperty()
  tempIgnoreAreas: string;
  @ApiPropertyOptional()
  comment?: string;
  @ApiProperty()
  branchName: string;
  @ApiProperty()
  baselineBranchName: string;
  @ApiProperty()
  merge: boolean;

  constructor(testRun: TestRun) {
    this.id = testRun.id;
    this.buildId = testRun.buildId;
    this.imageName = testRun.imageName;
    this.diffName = testRun.diffName;
    this.diffPercent = testRun.diffPercent;
    this.diffTollerancePercent = testRun.diffTollerancePercent;
    this.status = testRun.status;
    this.testVariationId = testRun.testVariationId;
    this.name = testRun.name;
    this.baselineName = testRun.baselineName;
    this.os = testRun.os;
    this.browser = testRun.browser;
    this.viewport = testRun.viewport;
    this.device = testRun.device;
    this.customTags = testRun.customTags;
    this.ignoreAreas = testRun.ignoreAreas;
    this.tempIgnoreAreas = testRun.tempIgnoreAreas;
    this.comment = testRun.comment;
    this.branchName = testRun.branchName;
    this.baselineBranchName = testRun.baselineBranchName;
    this.merge = testRun.merge;
  }
}
