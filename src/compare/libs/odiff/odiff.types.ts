import { RenderingNoiseConfig } from '../rendering-noise.config';

export type OdiffConfig = RenderingNoiseConfig & {
  outputDiffMask: boolean;
  failOnLayoutDiff: boolean;
  threshold: number;
  antialiasing: boolean;
};

export type OdiffIgnoreRegions = Array<{
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}>;
