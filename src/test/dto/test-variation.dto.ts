import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsUUID, IsJSON } from 'class-validator';
import { IgnoreAreaDto } from './ignore-area.dto';

export class TestVariationDto {
  @ApiProperty()
  @IsUUID()
  readonly id: string;

  @ApiProperty()
  @IsString()
  readonly name: string;

  @ApiProperty()
  @IsString()
  readonly baselineName: string;

  @ApiProperty()
  @IsString()
  readonly os: string;

  @ApiProperty()
  @IsString()
  readonly browser: string;

  @ApiProperty()
  @IsString()
  readonly viewport: string;

  @ApiProperty()
  @IsString()
  readonly device: string;

  @ApiProperty()
  @IsJSON()
  readonly ignoreAreas: IgnoreAreaDto[];

  constructor(testVariation: TestVariationDto) {
    this.id = testVariation.id
    this.name = testVariation.name
    this.baselineName = testVariation.baselineName
    this.os = testVariation.os
    this.browser = testVariation.browser
    this.device = testVariation.device
    this.ignoreAreas = testVariation.ignoreAreas
  }
}
