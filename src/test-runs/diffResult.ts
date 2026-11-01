import { TestStatus } from '@prisma/client';

export interface StampedSignature {
  threshold: number;
  includeAA: boolean;
  signature: number[];
}

export interface DiffResult {
  status: TestStatus | undefined;
  diffName: string | null;
  pixelMisMatchCount: number | undefined;
  diffPercent: number | undefined;
  isSameDimension: boolean | undefined;
  vlmDescription?: string;
  changeSignature?: StampedSignature;
  imageThumbnailName?: string;
  diffThumbnailName?: string;
}
