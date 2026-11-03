import { RenderingNoiseConfig } from '../rendering-noise.config';

export interface LooksSameConfig extends RenderingNoiseConfig {
  strict?: boolean;
  tolerance?: number;
  antialiasingTolerance?: number;
  ignoreAntialiasing?: boolean;
  ignoreCaret?: boolean;
  allowDiffDimensions?: boolean;
}
