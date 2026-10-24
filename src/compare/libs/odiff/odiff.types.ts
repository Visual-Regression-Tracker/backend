import { BlurAmplitudeConfig } from '../blur-amplitude.config';

export type OdiffConfig = BlurAmplitudeConfig & {
  /** Output full diff image. */
  outputDiffMask: boolean;
  /** Do not compare images and produce output if images layout is different. */
  failOnLayoutDiff: boolean;
  /** Color difference threshold (from 0 to 1). Less more precise. */
  threshold: number;
  /** If this is true, antialiased pixels are not counted to the diff of an image */
  antialiasing: boolean;
};

export type OdiffIgnoreRegions = Array<{
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}>;
