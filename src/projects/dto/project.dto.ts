import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsString, IsNumber, IsBoolean, IsEnum, IsJSON } from 'class-validator';
import { ImageComparison, Project } from '@prisma/client';

export class ProjectDto implements Project {
  @ApiProperty()
  @IsUUID()
  readonly id: string;

  @ApiProperty()
  @IsNumber()
  readonly buildsCounter: number;

  @ApiProperty()
  @IsString()
  readonly name: string;

  @ApiProperty()
  @IsString()
  readonly mainBranchName: string;

  @ApiProperty()
  readonly createdAt: Date;

  @ApiProperty()
  readonly updatedAt: Date;

  @ApiProperty()
  @IsBoolean()
  autoApproveFeature: boolean;

  @ApiProperty()
  @IsEnum(ImageComparison)
  imageComparison: ImageComparison;

  @ApiProperty()
  @IsNumber()
  maxBuildAllowed: number;

  @ApiProperty()
  @IsNumber()
  maxBranchLifetime: number;

  @ApiProperty()
  @IsJSON()
  imageComparisonConfig: string;
}
