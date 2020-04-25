import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CreateIgnoreAreaDto } from './create-ignoreArea.dto';

export class IgnoreAreaDto extends CreateIgnoreAreaDto {
  @ApiProperty()
  @IsUUID()
  readonly id: string;
}
