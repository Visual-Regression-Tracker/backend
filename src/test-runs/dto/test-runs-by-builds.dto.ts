import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export const MAX_BUILDS_PER_REQUEST = 500;

export class TestRunsByBuildsDto {
  @ApiProperty({ type: [String], maxItems: MAX_BUILDS_PER_REQUEST })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BUILDS_PER_REQUEST)
  @IsUUID('all', { each: true })
  readonly buildIds: string[];
}
