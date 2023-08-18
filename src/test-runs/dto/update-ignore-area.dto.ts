import { ApiProperty } from '@nestjs/swagger';
import { IgnoreAreaDto } from './ignore-area.dto';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';

export class UpdateIgnoreAreasDto {
  @ApiProperty({type: String, isArray: true })
  @Type(() => String)
  @ValidateNested({ each: true })
  readonly ids: string[];

  @ApiProperty({ type: IgnoreAreaDto, isArray: true })
  @Type(() => IgnoreAreaDto)
  @ValidateNested({ each: true })
  readonly ignoreAreas: IgnoreAreaDto[];
}
