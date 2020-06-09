import { ApiProperty } from '@nestjs/swagger';
import { Build, TestRun, TestStatus } from '@prisma/client';

export class BuildDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  number: number | null;

  @ApiProperty()
  branchName: string | null;

  @ApiProperty()
  status: string | null;

  @ApiProperty()
  projectId: string;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  userId: string | null;

  @ApiProperty()
  passedCount: number;
  @ApiProperty()
  unresolvedCount: number;
  @ApiProperty()
  failedCount: number;

  constructor(build: Build & { testRuns: TestRun[] }) {
    this.id = build.id;
    this.number = build.number;
    this.branchName = build.branchName;
    this.status = build.status;
    this.projectId = build.projectId;
    this.updatedAt = build.updatedAt;
    this.createdAt = build.createdAt;

    this.passedCount = 0;
    this.unresolvedCount = 0;
    this.failedCount = 0;

    build.testRuns.forEach(testRun => {
      switch (testRun.status) {
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

    if (build.testRuns.length === 0) {
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
