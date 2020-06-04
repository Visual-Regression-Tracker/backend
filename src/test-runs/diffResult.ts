import { TestStatus } from '@prisma/client';

export interface DiffResult {
  status: TestStatus;
  diffName: string;
  pixelMisMatchCount: number;
  diffPercent: number;
  isSameDimension: boolean;
}
