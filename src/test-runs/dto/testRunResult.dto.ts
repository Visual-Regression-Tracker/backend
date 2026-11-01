import { TestRun, TestVariation } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TestRunDto } from './testRun.dto';

export class TestRunResultDto extends TestRunDto {
  @ApiPropertyOptional()
  pixelMisMatchCount?: number | null;
  @ApiPropertyOptional()
  override vlmDescription?: string | null;
  @ApiProperty()
  url: string;
  @ApiProperty()
  override baselineName: string | null;

  constructor(testRun: TestRun, testVariation: TestVariation) {
    super(testRun);
    this.baselineName = testVariation.baselineName;
    this.pixelMisMatchCount = testRun.pixelMisMatchCount;
    this.vlmDescription = testRun.vlmDescription;
    this.url = `${process.env.APP_FRONTEND_URL}/${testVariation.projectId}?buildId=${testRun.buildId}&testId=${testRun.id}`;
  }
}
