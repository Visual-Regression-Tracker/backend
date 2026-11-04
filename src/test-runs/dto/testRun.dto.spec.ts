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

  describe('noiseAnalysis', () => {
    const regions = [{ x: 1, y: 2, width: 3, height: 4, weight: 0.5 }];
    const stored = {
      version: 1,
      verdict: 'noise',
      score: 0.2,
      reason: null,
      config: { blur: { amplitudeThreshold: 80, solidShareMax: 0.01 }, dinov2: { distanceThreshold: 0.15 } },
      blur: { verdict: 'noise', score: 0.1, signals: { amplitude: 1, solidShare: 0, density: 0.3 }, regions },
      dinov2: { verdict: 'noise', score: 0.2, signals: { distance: 0.05, patches: 9 }, regions },
      computedAt: '2026-11-04T10:00:00.000Z',
    };

    it('is null for a run that was never analysed', () => {
      expect(new TestRunDto(generateTestRun({ noiseAnalysis: null })).noiseAnalysis).toBeNull();
    });

    it('carries the pending marker as stored', () => {
      const pending = { pending: true, requestedAt: '2026-11-04T10:00:00.000Z' };

      expect(new TestRunDto(generateTestRun({ noiseAnalysis: pending })).noiseAnalysis).toEqual(pending);
    });

    it('carries a result without the regions of either stage', () => {
      const dto = new TestRunDto(generateTestRun({ noiseAnalysis: stored }));

      expect(dto.noiseAnalysis).toEqual({
        ...stored,
        blur: { verdict: 'noise', score: 0.1, signals: { amplitude: 1, solidShare: 0, density: 0.3 } },
        dinov2: { verdict: 'noise', score: 0.2, signals: { distance: 0.05, patches: 9 } },
      });
      expect(JSON.stringify(dto)).not.toContain('regions');
    });
  });
});
