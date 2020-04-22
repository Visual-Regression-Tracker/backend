import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsBase64 } from 'class-validator';
import { Test } from '../test.entity';
import config from 'config';

export class CreateTestResponseDto {
  @ApiProperty()
  readonly name: string;

  @ApiProperty()
  readonly status: string;

  @ApiProperty()
  readonly pixelMisMatchCount: number;

  @ApiProperty()
  readonly url: string;

  constructor(test: Test) {
    this.name = test.name;
    this.status = test.status;
    this.pixelMisMatchCount = test.pixelMisMatchCount;
    this.url = `${config.app.frontendUrl}/test/${test.id}`;
  }
}
