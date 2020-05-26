import { TestStatus } from '@prisma/client';

export interface DiffResult {
  status: TestStatus;
  imageName: string;
  pixelMisMatchCount: number;
  diffPercent: number;
  isSameDimension: boolean;
}
