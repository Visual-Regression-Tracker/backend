import { BlurAmplitudeConfig } from '../blur-amplitude.config';

export interface PixelmatchConfig extends BlurAmplitudeConfig {
  allowDiffDimensions?: boolean;
  ignoreAntialiasing: boolean;
  threshold: number;
}
