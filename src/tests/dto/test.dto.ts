import { ApiProperty } from '@nestjs/swagger';
import { Test } from '../test.entity';
import { CreateTestRequestDto } from './create-test-request.dto';

export class TestDto extends CreateTestRequestDto {
  @ApiProperty()
  readonly id: string;

  @ApiProperty()
  readonly name: string;

  @ApiProperty()
  readonly imageBase64: string;

  @ApiProperty()
  readonly os: string;

  @ApiProperty()
  readonly browser: string;

  @ApiProperty()
  readonly viewport: string;

  @ApiProperty()
  readonly device: string;

  @ApiProperty()
  readonly buildId: string;

  @ApiProperty()
  readonly baselineUrl: string;

  @ApiProperty()
  readonly imageUrl: string;

  @ApiProperty()
  readonly diffUrl: string;

  @ApiProperty()
  readonly status: string;

  @ApiProperty()
  readonly pixelMisMatchCount: number;

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
  }
}
