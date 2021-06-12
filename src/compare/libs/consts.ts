import { TestStatus } from '@prisma/client';
import { DiffResult } from 'src/test-runs/diffResult';

export const NO_BASELINE_RESULT: DiffResult = {
  status: undefined,
  diffName: null,
  pixelMisMatchCount: undefined,
  diffPercent: undefined,
  isSameDimension: undefined,
};

export const EQUAL_RESULT: DiffResult = {
  ...NO_BASELINE_RESULT,
  status: TestStatus.ok,
  pixelMisMatchCount: 0,
  diffPercent: 0,
  isSameDimension: true,
};

export const DIFF_DIMENSION_RESULT: DiffResult = {
  ...NO_BASELINE_RESULT,
  status: TestStatus.unresolved,
  isSameDimension: false,
};
