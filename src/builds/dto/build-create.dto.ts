import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class CreateBuildDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly ciBuildId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly branchName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  readonly baselineBranchName?: string;

  @ApiProperty()
  @IsString()
  readonly project: string;
}
