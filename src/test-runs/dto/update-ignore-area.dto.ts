import { ApiProperty } from '@nestjs/swagger';
import { IgnoreAreaDto } from './ignore-area.dto';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested, IsString } from 'class-validator';

export class UpdateIgnoreAreasDto {
  @ApiProperty({ type: String, isArray: true })
  @IsArray()
  @IsString({ each: true })
  readonly ids!: string[];

  @ApiProperty({ type: IgnoreAreaDto, isArray: true })
  @IsArray()
  @Type(() => IgnoreAreaDto)
  @ValidateNested({ each: true })
  readonly ignoreAreas!: IgnoreAreaDto[];
}
