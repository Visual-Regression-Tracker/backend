import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class BaselineDataDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  os?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  browser?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  viewport?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  device?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customTags?: string;

  @ApiProperty()
  @IsString()
  branchName: string;
}
