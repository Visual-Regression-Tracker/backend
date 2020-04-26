import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsUUID } from 'class-validator';
import { TestVariationDto } from './test-variation.dto';
import { TestRun } from 'src/test-runs/testRun.entity';
import config from 'config';

export class TestRunDto {
  @ApiProperty()
  @IsString()
  readonly id: string;

  @ApiProperty()
  readonly testVariation: TestVariationDto;

  @ApiProperty()
  @IsString()
  readonly imageName: string;

  @ApiProperty()
  @IsString()
  readonly diffName: string;

  @ApiProperty()
  @IsString()
  readonly status: string;

  @ApiProperty()
  @IsNumber()
  readonly pixelMisMatchCount: number;

  @ApiProperty()
  @IsString()
  readonly url: string;

  constructor(testRun: TestRun) {
    this.id = testRun.id;
    this.imageName = testRun.imageName;
    this.diffName = testRun.diffName;
    this.status = testRun.status;
    this.pixelMisMatchCount = testRun.pixelMisMatchCount;
    this.testVariation = new TestVariationDto(testRun.testVariation)
    this.url = `${config.app.frontendUrl}/test-run/${testRun.id}`;
  }
}
