import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsArray } from 'class-validator';
import { CreateIgnoreAreaDto } from './create-ignoreArea.dto';

export class UpdateIgnoreAreaDto {
  @ApiProperty()
  @IsUUID()
  readonly testId: string;

  @ApiProperty()
  @IsArray()
  readonly ignoreAreas: CreateIgnoreAreaDto[];
}
