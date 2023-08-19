import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BaseTestVariationDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  baselineName?: string;

  @ApiProperty()
  branchName: string;

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

  @ApiPropertyOptional()
  ignoreAreas?: string;

  @ApiProperty()
  projectId: string;

  @ApiPropertyOptional()
  comment?: string;
}
