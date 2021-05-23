import { Baseline, Build, ImageComparison, Project, TestRun, TestVariation } from '@prisma/client';

export const TEST_PROJECT: Project = {
  id: '1',
  name: 'Test Project',
  buildsCounter: 2,
  mainBranchName: 'master',
  createdAt: new Date(),
  updatedAt: new Date(),
  autoApproveFeature: true,
  diffDimensionsFeature: true,
  ignoreAntialiasing: true,
  threshold: 0.1,
  imageComparison: ImageComparison.pixelmatch,
};

export const TEST_BUILD: Build = {
  id: 'a9385fc1-884d-4f9f-915e-40da0e7773d5',
  ciBuildId: 'ciBuildId',
  number: 2345,
  branchName: 'develop',
  status: 'new',
  projectId: 'e0a37894-6f29-478d-b13e-6182fecc715e',
  updatedAt: new Date(),
  createdAt: new Date(),
  userId: '2341235',
  isRunning: true,
};

export const generateBaseline = (baseline?: Partial<Baseline>): Baseline => {
  return {
    id: 'baselineId',
    baselineName: 'baselineName',
    testVariationId: 'testVariationId',
    testRunId: 'testRunId',
    updatedAt: new Date(),
    createdAt: new Date(),
    ...baseline,
  };
};

export const generateTestVariation = (
  testVariation?: Partial<TestVariation>,
  baselines?: Baseline[]
): TestVariation & { baselines: Baseline[] } => {
  return {
    id: '123',
    projectId: 'project Id',
    name: 'Test name',
    baselineName: 'baselineName',
    os: 'OS',
    browser: 'browser',
    viewport: 'viewport',
    device: 'device',
    customTags: '',
    ignoreAreas: '[]',
    comment: 'some comment',
    createdAt: new Date(),
    updatedAt: new Date(),
    branchName: 'master',
    ...testVariation,
    baselines: baselines ?? [generateBaseline()],
  };
};

export const generateTestRun = (testRun?: Partial<TestRun>): TestRun => {
  return {
    id: '10fb5e02-64e0-4cf5-9f17-c00ab3c96658',
    imageName: '1592423768112.screenshot.png',
    diffName: 'diffName',
    diffPercent: 12,
    diffTollerancePercent: 1,
    pixelMisMatchCount: 123,
    status: 'new',
    buildId: '146e7a8d-89f0-4565-aa2c-e61efabb0afd',
    testVariationId: '3bc4a5bc-006e-4d43-8e4e-eaa132627fca',
    updatedAt: new Date(),
    createdAt: new Date(),
    name: 'ss2f77',
    browser: 'chromium',
    device: null,
    os: null,
    viewport: '1800x1600',
    customTags: '',
    baselineName: null,
    ignoreAreas: '[]',
    tempIgnoreAreas: '[]',
    comment: 'some comment',
    baselineBranchName: 'master',
    branchName: 'develop',
    merge: false,
    ...testRun,
  };
};
