import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Build } from '@prisma/client';
import { TestRunDto } from '../../test-runs/dto/testRun.dto';
import { BuildStats, statsOf } from '../build-stats';

export class BuildDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional()
  ciBuildId?: string | null;

  @ApiProperty()
  number: number | null;

  @ApiProperty()
  branchName: string | null;

  @ApiProperty()
  status: string;

  @ApiProperty()
  projectId: string;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional()
  userId?: string | null;

  @ApiProperty()
  passedCount: number;
  @ApiProperty()
  unresolvedCount: number;
  @ApiProperty()
  failedCount: number;
  @ApiProperty()
  isRunning: boolean | null;
  @ApiProperty()
  merge: boolean;

  constructor(build: Build & { testRuns?: TestRunDto[] }, stats?: BuildStats) {
    this.id = build.id;
    this.ciBuildId = build.ciBuildId;
    this.number = build.number;
    this.branchName = build.branchName;
    this.userId = build.userId;
    this.projectId = build.projectId;
    this.updatedAt = build.updatedAt;
    this.createdAt = build.createdAt;
    this.isRunning = build.isRunning;

    const counts = stats ?? statsOf(build.testRuns ?? []);
    this.passedCount = counts.passedCount;
    this.unresolvedCount = counts.unresolvedCount;
    this.failedCount = counts.failedCount;
    this.merge = counts.merge;

    const hasTestRuns = stats
      ? this.passedCount + this.unresolvedCount + this.failedCount > 0
      : !!build.testRuns && build.testRuns.length > 0;
    this.status = hasTestRuns ? 'passed' : 'new';
    if (this.failedCount > 0) {
      this.status = 'failed';
    }
    if (this.unresolvedCount > 0) {
      this.status = 'unresolved';
    }
  }
}
