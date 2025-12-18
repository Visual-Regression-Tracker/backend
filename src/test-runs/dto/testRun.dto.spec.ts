import { TestRun } from '@prisma/client';
import { generateTestRun } from '../../_data_';
import { TestRunDto } from './testRun.dto';

describe('TestRunDto', () => {
  it('should map all fields correctly including vlmDescription', () => {
    const testRun: TestRun = generateTestRun({
      vlmDescription: 'VLM analysis result',
    });

    const result = new TestRunDto(testRun);

    expect(result).toMatchObject({
      id: testRun.id,
      buildId: testRun.buildId,
      imageName: testRun.imageName,
      diffName: testRun.diffName,
      diffPercent: testRun.diffPercent,
      diffTollerancePercent: testRun.diffTollerancePercent,
      status: testRun.status,
      testVariationId: testRun.testVariationId,
      name: testRun.name,
      baselineName: testRun.baselineName,
      os: testRun.os,
      browser: testRun.browser,
      viewport: testRun.viewport,
      device: testRun.device,
      customTags: testRun.customTags,
      ignoreAreas: testRun.ignoreAreas,
      tempIgnoreAreas: testRun.tempIgnoreAreas,
      comment: testRun.comment,
      branchName: testRun.branchName,
      baselineBranchName: testRun.baselineBranchName,
      merge: testRun.merge,
      vlmDescription: testRun.vlmDescription,
    });
  });
});
