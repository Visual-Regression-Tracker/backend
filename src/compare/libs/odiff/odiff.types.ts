import { BlurAmplitudeConfig } from '../blur-amplitude.config';

export type OdiffConfig = BlurAmplitudeConfig & {
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
