import { IgnoreAreaDto } from '../../test-runs/dto/ignore-area.dto';
import { BlurAmplitudeOptions } from './pixelmatch/blur-amplitude.core';

export interface ImageCompareInput {
  baseline: string | null;
  image: string;
  imageBuffer?: Buffer;
  diffTollerancePercent: number;
  ignoreAreas: IgnoreAreaDto[];
  saveDiffAsFile: boolean;
  blurAmplitude?: BlurAmplitudeOptions;
}
