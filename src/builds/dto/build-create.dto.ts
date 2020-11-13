import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, IsOptional, isUUID } from 'class-validator';

export class CreateBuildDto {
  @ApiProperty()
  @IsOptional()
  @IsUUID()
  readonly id?: string;

  @ApiProperty()
  @IsString()
  readonly branchName: string;

  @ApiProperty()
  @IsString()
  readonly project: string;
}
