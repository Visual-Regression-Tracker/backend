import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsUUID } from 'class-validator';
import { IgnoreAreaDto } from './ignore-area.dto';

export class TestVariationDto {
  @ApiProperty()
  readonly id: string;

  @ApiProperty()
  readonly name: string;

  @ApiProperty()
  readonly baselineName: string;

  @ApiProperty()
  readonly os: string;

  @ApiProperty()
  readonly browser: string;

  @ApiProperty()
  readonly viewport: string;

  @ApiProperty()
  readonly device: string;

  @ApiProperty()
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
