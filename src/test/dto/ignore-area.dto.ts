import { ApiProperty } from '@nestjs/swagger';
import { IsNumber } from 'class-validator';

export class IgnoreAreaDto {
  @ApiProperty()
  readonly x: number;

  @ApiProperty()
  readonly y: number;

  @ApiProperty()
  readonly width: number;

  @ApiProperty()
  readonly height: number;
}
