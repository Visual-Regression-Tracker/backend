import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsUUID } from 'class-validator';
import { TestVariationDto } from './test-variation.dto';
import { TestRun } from 'src/test-runs/testRun.entity';
import config from 'config';

export class TestRunDto {
  @ApiProperty()
  readonly id: string;

  @ApiProperty()
  readonly testVariation: TestVariationDto;

  @ApiProperty()
  readonly imageName: string;

  @ApiProperty()
  readonly diffName: string;

  @ApiProperty()
  readonly status: string;

  @ApiProperty()
  readonly pixelMisMatchCount: number;

  @ApiProperty()
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
