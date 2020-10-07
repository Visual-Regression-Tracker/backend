import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsString, IsNumber } from 'class-validator';
import { Project } from '@prisma/client';

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
}
