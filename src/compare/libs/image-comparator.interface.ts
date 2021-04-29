import { DiffResult } from 'src/test-runs/diffResult';
import { IgnoreAreaDto } from 'src/test-runs/dto/ignore-area.dto';

export interface ImageCompareInput {
  baseline: string;
  image: string;
  diffTollerancePercent: number;
  ignoreAreas: IgnoreAreaDto[];
  saveDiffAsFile: boolean;
}

export interface ImageCompareConfig {
  allowDiffDimensions: boolean;
  ignoreAntialiasing: boolean;
  threshold: number;
}

export interface ImageComparator {
  getDiff(data: ImageCompareInput, config: ImageCompareConfig): DiffResult;
}
