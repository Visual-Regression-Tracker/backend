import { ApiProperty } from '@nestjs/swagger';
import { Test } from '../test.entity';
import { CreateTestRequestDto } from './create-test-request.dto';
import { IgnoreAreaDto } from './ignoreArea.dto';
import { IsUUID, IsString, IsNumber, IsOptional } from 'class-validator';

export class TestDto extends CreateTestRequestDto {
  @ApiProperty()
  @IsUUID()
  readonly id: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  readonly baselineUrl: string;

  @ApiProperty()
  @IsString()
  readonly imageUrl: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  readonly diffUrl: string;

  @ApiProperty()
  @IsString()
  readonly status: string;

  @ApiProperty()
  @IsNumber()
  @IsOptional()
  readonly pixelMisMatchCount: number;

  @ApiProperty()
  readonly ignoreAreas: IgnoreAreaDto[];

  constructor(test: Test) {
    super();
    this.id = test.id;
    this.baselineUrl = test.baselineUrl;
    this.imageUrl = test.imageUrl;
    this.diffUrl = test.diffUrl;
    this.status = test.status;
    this.pixelMisMatchCount = test.pixelMisMatchCount;
    this.name = test.name;
    this.os = test.os;
    this.browser = test.browser;
    this.viewport = test.viewport;
    this.device = test.device;
    this.buildId = test.buildId;
    this.ignoreAreas = test.ignoreAreas;
  }
}
