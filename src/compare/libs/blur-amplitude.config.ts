import { Logger } from '@nestjs/common';
import { BlurAmplitudeOptions, DEFAULT_BLUR_AMPLITUDE_THRESHOLD } from './pixelmatch/blur-amplitude.core';

export interface BlurAmplitudeConfig {
  blurAmplitudeFilter?: boolean;
  blurAmplitudeThreshold?: number;
  dinov2Check?: boolean;
  dinov2Threshold?: number;
}

export const MAX_BLUR_AMPLITUDE_THRESHOLD = 128;

// strongest of 57 anti-aliasing-only real pairs: 0.133
export const DEFAULT_DINOV2_THRESHOLD = 0.15;
const MAX_DINOV2_THRESHOLD = 2;

export function splitBlurAmplitudeConfig<T extends BlurAmplitudeConfig>(
  config: T,
  logger: Logger
): { blurAmplitude?: BlurAmplitudeOptions; comparatorConfig: T } {
  const { blurAmplitudeFilter, blurAmplitudeThreshold, dinov2Check, dinov2Threshold, ...comparatorConfig } = config;
  if (blurAmplitudeFilter !== true) {
    return { comparatorConfig: comparatorConfig as T };
  }

  let threshold = DEFAULT_BLUR_AMPLITUDE_THRESHOLD;
  if (blurAmplitudeThreshold !== undefined) {
    const valid =
      typeof blurAmplitudeThreshold === 'number' &&
      blurAmplitudeThreshold >= 0 &&
      blurAmplitudeThreshold <= MAX_BLUR_AMPLITUDE_THRESHOLD;
    if (valid) {
      threshold = blurAmplitudeThreshold;
    } else {
      logger.warn(
        `blurAmplitudeThreshold ${JSON.stringify(blurAmplitudeThreshold)} is not a number from 0 to ${MAX_BLUR_AMPLITUDE_THRESHOLD}, using ${DEFAULT_BLUR_AMPLITUDE_THRESHOLD}`
      );
    }
  }
  const blurAmplitude: BlurAmplitudeOptions = { threshold };
  if (dinov2Check === true) {
    blurAmplitude.dinov2 = { threshold: dinov2ThresholdOf(dinov2Threshold, logger) };
  }
  return { blurAmplitude, comparatorConfig: comparatorConfig as T };
}

function dinov2ThresholdOf(value: unknown, logger: Logger): number {
  if (value === undefined) {
    return DEFAULT_DINOV2_THRESHOLD;
  }
  if (typeof value === 'number' && value > 0 && value <= MAX_DINOV2_THRESHOLD) {
    return value;
  }
  logger.warn(
    `dinov2Threshold ${JSON.stringify(value)} is not a number above 0 and up to ${MAX_DINOV2_THRESHOLD}, using ${DEFAULT_DINOV2_THRESHOLD}`
  );
  return DEFAULT_DINOV2_THRESHOLD;
}
