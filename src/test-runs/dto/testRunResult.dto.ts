import { TestRun, TestStatus, TestVariation } from '@prisma/client';

export class TestRunResultDto {
  id: string
  imageName: string
  diffName?: string
  diffPercent: number
  diffTollerancePercent?: number;
  pixelMisMatchCount?: number;
  status: TestStatus;
  url: string;

  constructor(testRun: TestRun, testVariation: TestVariation) {
    this.id = testRun.id
    this.imageName = testRun.imageName
    this.diffName = testRun.diffName
    this.diffPercent = testRun.diffPercent
    this.diffTollerancePercent = testRun.diffTollerancePercent
    this.pixelMisMatchCount = testRun.pixelMisMatchCount
    this.status = testRun.status
    this.url = `${process.env.APP_FRONTEND_URL}/${testVariation.projectId}?buildId=${testRun.buildId}&testId=${testRun.id}`
  }
}
