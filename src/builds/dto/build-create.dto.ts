import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, IsOptional } from 'class-validator';

export class CreateBuildDto {
  @ApiProperty()
  @IsString()
  @IsOptional()
  readonly branchName: string;

  @ApiProperty()
  @IsString()
  readonly project: string;
}
