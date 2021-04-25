import { DiffResult } from 'src/test-runs/diffResult';
import { IgnoreAreaDto } from 'src/test-runs/dto/ignore-area.dto';

export interface ImageCompareInput {
  baseline: string;
  image: string;
  ignoreAreas: IgnoreAreaDto[];
}

export interface ImageComparator {
  getDiff(data: ImageCompareInput): DiffResult;
}
