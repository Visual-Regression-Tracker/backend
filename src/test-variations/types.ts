import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class MergeParams {
  @ApiProperty()
  @IsUUID()
  projectId!: string;
  @ApiProperty()
  @IsNotEmpty()
  fromBranch!: string;
  @ApiProperty()
  @IsNotEmpty()
  toBranch!: string;
}
