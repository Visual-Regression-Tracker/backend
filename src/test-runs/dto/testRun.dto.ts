import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TestRun, TestStatus } from '@prisma/client';

export class TestRunDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  buildId: string;
  @ApiProperty()
  imageName: string;
  @ApiPropertyOptional()
  imageThumbnailName?: string | null;
  @ApiPropertyOptional()
  diffThumbnailName?: string | null;
  @ApiProperty()
  diffName: string | null;
  @ApiProperty()
  diffPercent: number | null;
  @ApiProperty()
  diffTollerancePercent: number;
  @ApiProperty()
  status: TestStatus;
  @ApiProperty()
  testVariationId: string | null;
  @ApiProperty()
  name: string;
  @ApiProperty()
  baselineName: string | null;
  @ApiProperty()
  os: string | null;
  @ApiProperty()
  browser: string | null;
  @ApiProperty()
  viewport: string | null;
  @ApiProperty()
  device: string | null;
  @ApiProperty()
  customTags: string | null;
  @ApiProperty()
  ignoreAreas: string;
  @ApiProperty()
  tempIgnoreAreas: string;
  @ApiPropertyOptional()
  comment?: string | null;
  @ApiProperty()
  branchName: string;
  @ApiProperty()
  baselineBranchName: string | null;
  @ApiProperty()
  merge: boolean;
  @ApiPropertyOptional()
  vlmDescription?: string | null;

  constructor(testRun: TestRun) {
    this.id = testRun.id;
    this.buildId = testRun.buildId;
    this.imageName = testRun.imageName;
    this.imageThumbnailName = testRun.imageThumbnailName;
    this.diffThumbnailName = testRun.diffThumbnailName;
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
    this.vlmDescription = testRun.vlmDescription;
  }
}
