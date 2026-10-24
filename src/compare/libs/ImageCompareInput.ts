import { IgnoreAreaDto } from '../../test-runs/dto/ignore-area.dto';

export interface ImageCompareInput {
  // null when the variation has no baseline yet; comparators then report NO_BASELINE_RESULT
  baseline: string | null;
  image: string;
  diffTollerancePercent: number;
  ignoreAreas: IgnoreAreaDto[];
  saveDiffAsFile: boolean;
}
