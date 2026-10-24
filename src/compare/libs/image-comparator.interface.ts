import { DiffResult } from '../../test-runs/diffResult';
import { ImageCompareInput } from './ImageCompareInput';
import { LooksSameConfig } from './looks-same/looks-same.types';
import { OdiffConfig } from './odiff/odiff.types';
import { PixelmatchConfig } from './pixelmatch/pixelmatch.types';
import { VlmConfig } from './vlm/vlm.types';

export type ImageCompareConfig = PixelmatchConfig | LooksSameConfig | OdiffConfig | VlmConfig;

export interface ImageComparator {
  /**
   * True when getDiff applies `data.blurAmplitude` itself — cheaper inside a
   * pass that has the images decoded already, and before anything expensive
   * (a diff written to storage, a VLM call). Otherwise CompareService measures
   * the pair afterwards and may overturn a failing verdict.
   */
  readonly appliesBlurAmplitudeFilter?: boolean;
  getDiff(data: ImageCompareInput, config: ImageCompareConfig): Promise<DiffResult>;
  parseConfig(configJson: string): ImageCompareConfig;
}
