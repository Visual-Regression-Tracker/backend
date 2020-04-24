import { ApiProperty } from '@nestjs/swagger';
import { Test } from '../test.entity';
import config from 'config';

export class CreateTestResponseDto {
  @ApiProperty()
  readonly id: string;

  @ApiProperty()
  readonly name: string;

  @ApiProperty()
  readonly status: string;

  @ApiProperty()
  readonly pixelMisMatchCount: number;

  @ApiProperty()
  readonly url: string;

  constructor(test: Test) {
    this.id = test.id;
    this.name = test.name;
    this.status = test.status;
    this.pixelMisMatchCount = test.pixelMisMatchCount;
    this.url = `${config.app.frontendUrl}/test/${test.id}`;
  }
}
