import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsString, IsNumber, IsInt, IsBoolean, IsEnum, IsJSON, IsDate, IsOptional } from 'class-validator';
import { ImageComparison, Project } from '@prisma/client';
import { Type } from 'class-transformer';

export class ProjectDto implements Omit<Project, 'noiseAnalysisConfig'> {
  @ApiProperty()
  @IsUUID()
  readonly id!: string;

  @ApiProperty()
  @IsNumber()
  readonly buildsCounter!: number;

  @ApiProperty()
  @IsString()
  readonly name!: string;

  @ApiProperty()
  @IsString()
  readonly mainBranchName!: string;

  @ApiProperty()
  @IsDate()
  @Type(() => Date)
  readonly createdAt!: Date;

  @ApiProperty()
  @IsDate()
  @Type(() => Date)
  readonly updatedAt!: Date;

  @ApiProperty()
  @IsBoolean()
  autoApproveFeature!: boolean;

  @ApiProperty()
  @IsEnum(ImageComparison)
  imageComparison!: ImageComparison;

  @ApiProperty()
  @IsInt()
  maxBuildAllowed!: number;

  @ApiProperty()
  @IsInt()
  maxBranchLifetime!: number;

  @ApiProperty()
  @IsJSON()
  imageComparisonConfig!: string;

  @ApiPropertyOptional()
  @IsJSON()
  @IsOptional()
  noiseAnalysisConfig?: string;

  @ApiProperty()
  @IsBoolean()
  bulkApproveVariations!: boolean;

  @ApiProperty()
  @IsString()
  bulkApproveGroupBy!: string;
}
