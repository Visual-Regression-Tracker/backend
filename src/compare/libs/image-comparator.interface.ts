import { DiffResult } from 'src/test-runs/diffResult';
import { ImageCompareInput } from './ImageCompareInput';
import { LooksSameConfig } from './looks-same/looks-same.types';
import { PixelmatchConfig } from './pixelmatch/pixelmatch.types';

export interface ImageComparator {
  getDiff(data: ImageCompareInput, config: PixelmatchConfig | LooksSameConfig): Promise<DiffResult>;
  parseConfig(configJson: string): PixelmatchConfig | LooksSameConfig;
}
