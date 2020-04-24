import { ApiProperty } from '@nestjs/swagger';
import { Test } from '../test.entity';
import config from 'config';
import { TestDto } from './test.dto';

export class CreateTestResponseDto extends TestDto {
  @ApiProperty()
  readonly url: string;

  constructor(test: Test) {
    super(test);
    this.url = `${config.app.frontendUrl}/test/${test.id}`;
  }
}
