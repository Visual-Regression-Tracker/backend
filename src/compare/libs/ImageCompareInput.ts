import { IgnoreAreaDto } from '../../test-runs/dto/ignore-area.dto';

export interface ImageCompareInput {
  baseline: string | null;
  image: string;
  imageBuffer?: Buffer;
  diffTollerancePercent: number;
  ignoreAreas: IgnoreAreaDto[];
  saveDiffAsFile: boolean;
}
