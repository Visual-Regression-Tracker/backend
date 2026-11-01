import { BlurAmplitudeConfig } from '../blur-amplitude.config';

export interface LooksSameConfig extends BlurAmplitudeConfig {
  strict?: boolean;
  tolerance?: number;
  antialiasingTolerance?: number;
  ignoreAntialiasing?: boolean;
  ignoreCaret?: boolean;
  allowDiffDimensions?: boolean;
}
