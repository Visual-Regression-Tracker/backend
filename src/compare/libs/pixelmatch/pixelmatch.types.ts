import { RenderingNoiseConfig } from '../rendering-noise.config';

export interface PixelmatchConfig extends RenderingNoiseConfig {
  allowDiffDimensions?: boolean;
  ignoreAntialiasing: boolean;
  threshold: number;
}
