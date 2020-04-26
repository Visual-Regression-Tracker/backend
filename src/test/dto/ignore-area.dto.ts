import { ApiProperty } from '@nestjs/swagger';
import { IsNumber } from 'class-validator';

export class IgnoreAreaDto {
  @ApiProperty()
  @IsNumber()
  readonly x: number;

  @ApiProperty()
  @IsNumber()
  readonly y: number;

  @ApiProperty()
  @IsNumber()
  readonly width: number;

  @ApiProperty()
  @IsNumber()
  readonly height: number;
}
