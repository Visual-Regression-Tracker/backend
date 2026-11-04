import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class NoiseSummaryEnvironmentDto {
  @ApiProperty({ type: String, nullable: true })
  browser!: string | null;

  @ApiProperty({ type: String, nullable: true })
  os!: string | null;

  @ApiProperty({ type: String, nullable: true })
  device!: string | null;

  @ApiProperty()
  unresolved!: number;

  @ApiProperty()
  noiseLike!: number;
}

export class NoiseSummaryDto {
  @ApiProperty()
  unresolved!: number;

  @ApiProperty()
  analysed!: number;

  @ApiProperty()
  noiseLike!: number;

  @ApiProperty({ type: NoiseSummaryEnvironmentDto, isArray: true })
  byEnvironment!: NoiseSummaryEnvironmentDto[];

  @ApiPropertyOptional({ description: 'Median share of noise-like runs over recent builds of the project, 0..1' })
  projectTypical?: number;
}
