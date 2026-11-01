import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export const MAX_IGNORE_AREA_COORDINATE = 1_000_000;

export class IgnoreAreaDto {
  @ApiPropertyOptional()
  @IsOptional()
  readonly id?: string;

  @ApiProperty()
  @IsNumber()
  @Min(-MAX_IGNORE_AREA_COORDINATE)
  @Max(MAX_IGNORE_AREA_COORDINATE)
  readonly x!: number;

  @ApiProperty()
  @IsNumber()
  @Min(-MAX_IGNORE_AREA_COORDINATE)
  @Max(MAX_IGNORE_AREA_COORDINATE)
  readonly y!: number;

  @ApiProperty()
  @IsNumber()
  readonly width!: number;

  @ApiProperty()
  @IsNumber()
  readonly height!: number;
}
