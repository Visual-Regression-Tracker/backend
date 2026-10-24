import { generateTestRun, generateTestVariation } from '../../_data_';
import { TestRunDto } from './testRun.dto';
import { TestRunResultDto } from './testRunResult.dto';

describe('TestRunResultDto', () => {
  const originalFrontendUrl = process.env.APP_FRONTEND_URL;

  afterEach(() => {
    if (originalFrontendUrl === undefined) {
      delete process.env.APP_FRONTEND_URL;
    } else {
      process.env.APP_FRONTEND_URL = originalFrontendUrl;
    }
  });

  it('extends the test run dto with mismatch count, analysis and a link to the run in the frontend', () => {
    process.env.APP_FRONTEND_URL = 'http://frontend';
    const testRun = generateTestRun({ pixelMisMatchCount: 42, vlmDescription: 'looks different', baselineName: 'run' });
    const testVariation = generateTestVariation({ projectId: 'project-id', baselineName: 'variation baseline' });

    const result = new TestRunResultDto(testRun, testVariation);

    expect(result).toBeInstanceOf(TestRunDto);
    expect(result).toMatchObject({
      id: testRun.id,
      buildId: testRun.buildId,
      status: testRun.status,
      pixelMisMatchCount: 42,
      vlmDescription: 'looks different',
      url: `http://frontend/project-id?buildId=${testRun.buildId}&testId=${testRun.id}`,
    });
  });

  it('takes the baseline name from the test variation, not from the test run', () => {
    const testRun = generateTestRun({ baselineName: 'baseline of the run' });
    const testVariation = generateTestVariation({ baselineName: 'baseline of the variation' });

    const result = new TestRunResultDto(testRun, testVariation);

    expect(result.baselineName).toBe('baseline of the variation');
  });

  it('builds the link even when the frontend url is not configured', () => {
    delete process.env.APP_FRONTEND_URL;
    const testRun = generateTestRun();
    const testVariation = generateTestVariation({ projectId: 'project-id' });

    const result = new TestRunResultDto(testRun, testVariation);

    // NOTE: current behavior — a missing APP_FRONTEND_URL is rendered as the literal string "undefined"
    expect(result.url).toBe(`undefined/project-id?buildId=${testRun.buildId}&testId=${testRun.id}`);
  });
});
