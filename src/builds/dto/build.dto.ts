import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Build, TestStatus } from '@prisma/client';
import { TestRunDto } from 'src/test-runs/dto/testRun.dto';

export class BuildDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional()
  ciBuildId?: string;

  @ApiProperty()
  number: number;

  @ApiProperty()
  branchName: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  projectId: string;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional()
  userId?: string;

  @ApiProperty()
  passedCount: number;
  @ApiProperty()
  unresolvedCount: number;
  @ApiProperty()
  failedCount: number;
  @ApiProperty()
  isRunning: boolean;
  @ApiProperty()
  merge: boolean;

  constructor(build: Build & { testRuns?: TestRunDto[] }) {
    this.id = build.id;
    this.ciBuildId = build.ciBuildId;
    this.number = build.number;
    this.branchName = build.branchName;
    this.userId = build.userId;
    this.status = build.status;
    this.projectId = build.projectId;
    this.updatedAt = build.updatedAt;
    this.createdAt = build.createdAt;
    this.isRunning = build.isRunning;

    this.passedCount = 0;
    this.unresolvedCount = 0;
    this.failedCount = 0;

    this.merge = false;
    if (build.testRuns) {
      // determine if merge
      this.merge = build.testRuns.some((testRun) => testRun.merge);

      // calculate statistics
      build.testRuns.forEach((testRun) => {
        switch (testRun.status) {
          case TestStatus.autoApproved:
          case TestStatus.approved:
          case TestStatus.ok: {
            this.passedCount += 1;
            break;
          }
          case TestStatus.unresolved:
          case TestStatus.new: {
            this.unresolvedCount += 1;
            break;
          }
          case TestStatus.failed: {
            this.failedCount += 1;
            break;
          }
        }
      });
    }

    if (!build.testRuns || build.testRuns.length === 0) {
      this.status = 'new';
    } else {
      this.status = 'passed';
    }
    if (this.failedCount > 0) {
      this.status = 'failed';
    }
    if (this.unresolvedCount > 0) {
      this.status = 'unresolved';
    }
  }
}
