import { ApiProperty } from '@nestjs/swagger';
import { Build } from '../build.entity';
import { Test } from 'src/tests/test.entity';

export class BuildDto {
  @ApiProperty()
  readonly id: number;

  @ApiProperty()
  readonly projectName: string;

  @ApiProperty()
  readonly branchName: string;

  @ApiProperty()
  readonly status: string;

  @ApiProperty()
  readonly createdBy: string;

  @ApiProperty()
  readonly createdAt: Date;

  @ApiProperty()
  readonly tests: Test[];

  constructor(build: Build) {
    this.id = build.id;
    this.createdAt = build.createdAt;
    this.status = build.status;
    this.branchName = build.branchName;
    this.createdBy = build.user.email;
    this.projectName = build.project.name;
    this.tests = build.tests;
  }
}
