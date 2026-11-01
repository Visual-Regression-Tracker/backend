import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsString, IsNumber, IsInt, IsBoolean, IsEnum, IsJSON, IsDate } from 'class-validator';
import { ImageComparison, Project } from '@prisma/client';
import { Type } from 'class-transformer';

export class ProjectDto implements Project {
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

  @ApiProperty()
  @IsBoolean()
  bulkApproveVariations!: boolean;

  @ApiProperty()
  @IsString()
  bulkApproveGroupBy!: string;
}
