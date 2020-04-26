import { ApiProperty } from '@nestjs/swagger';
import { Build } from '../build.entity';
import { TestRun } from 'src/test-runs/testRun.entity';

export class BuildDto {
  @ApiProperty()
  readonly id: string;

  @ApiProperty()
  readonly branchName: string;

  @ApiProperty()
  readonly status: string;

  @ApiProperty()
  readonly createdBy: string;

  @ApiProperty()
  readonly createdAt: Date;

  @ApiProperty()
  readonly testRuns: TestRun[];

  constructor(build: Build) {
    this.id = build.id;
    this.createdAt = build.createdAt;
    this.status = build.status;
    this.branchName = build.branchName;
    this.testRuns = build.testRuns;
  }
}
