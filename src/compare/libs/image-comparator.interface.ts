import { DiffResult } from 'src/test-runs/diffResult';
import { ImageCompareInput } from './ImageCompareInput';
import { LooksSameConfig } from './looks-same/looks-same.types';
import { OdiffConfig } from './odiff/odiff.types';
import { PixelmatchConfig } from './pixelmatch/pixelmatch.types';

export type ImageCompareConfig = PixelmatchConfig | LooksSameConfig | OdiffConfig;

export interface ImageComparator {
  getDiff(data: ImageCompareInput, config: ImageCompareConfig): Promise<DiffResult>;
  parseConfig(configJson: string): ImageCompareConfig;
}
