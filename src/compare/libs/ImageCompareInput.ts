import { IgnoreAreaDto } from '../../test-runs/dto/ignore-area.dto';

export interface ImageCompareInput {
  baseline: string;
  image: string;
  diffTollerancePercent: number;
  ignoreAreas: IgnoreAreaDto[];
  saveDiffAsFile: boolean;
}
