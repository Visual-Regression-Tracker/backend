import { ApiProperty } from '@nestjs/swagger';
import { IgnoreAreaDto } from './ignore-area.dto';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';

export class UpdateIgnoreAreasDto {
  @ApiProperty({ isArray: true })
  readonly ids: string[];

  @ApiProperty({ type: IgnoreAreaDto, isArray: true })
  @Type(() => IgnoreAreaDto)
  @ValidateNested({ each: true })
  readonly ignoreAreas: IgnoreAreaDto[];
}
