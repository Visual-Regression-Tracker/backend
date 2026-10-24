import { IgnoreAreaDto } from '../../test-runs/dto/ignore-area.dto';
import { BlurAmplitudeOptions } from './pixelmatch/blur-amplitude.core';

export interface ImageCompareInput {
  // null when the variation has no baseline yet; comparators then report NO_BASELINE_RESULT
  baseline: string | null;
  image: string;
  diffTollerancePercent: number;
  ignoreAreas: IgnoreAreaDto[];
  saveDiffAsFile: boolean;
  /**
   * The project's rendering-noise filter, when it has one on. Read only by a
   * comparator that applies it itself (see ImageComparator); for the others
   * CompareService applies it to their verdict.
   */
  blurAmplitude?: BlurAmplitudeOptions;
}
