import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class CreateBuildDto {
  @ApiProperty()
  @IsOptional()
  readonly ciBuildId?: string;

  @ApiProperty()
  @IsString()
  readonly branchName: string;

  @ApiProperty()
  @IsString()
  readonly project: string;
}
