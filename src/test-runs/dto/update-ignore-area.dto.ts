import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';
import { IgnoreAreaDto } from './ignore-area.dto';

export class UpdateIgnoreAreasDto {
  @ApiProperty()
  readonly ids: string[];

  @ApiProperty({ type: [IgnoreAreaDto] })
  readonly ignoreAreas: IgnoreAreaDto[];
}
