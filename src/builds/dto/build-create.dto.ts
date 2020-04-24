import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

export class CreateBuildDto {
  @ApiProperty()
  @IsString()
  readonly branchName: string;

  @ApiProperty()
  @IsUUID()
  readonly projectId: string;
}
