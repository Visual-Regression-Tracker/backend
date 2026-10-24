import { Logger } from '@nestjs/common';
import {
  BlurAmplitudeOptions,
  DEFAULT_BLUR_AMPLITUDE_THRESHOLD,
  DEFAULT_BLUR_SIGMA,
} from './pixelmatch/blur-amplitude.core';

/**
 * The keys an image-comparison config carries to switch on the rendering-noise
 * filter (see pixelmatch/blur-amplitude.core.ts). A library that supports the
 * filter extends its config type with these; CompareService reads them and
 * strips them, so the library itself never sees them.
 */
export interface BlurAmplitudeConfig {
  // pass a failing comparison whose blurred change is no stronger than noise
  blurAmplitudeFilter?: boolean;
  // strongest blurred difference (0-128) still treated as noise
  blurAmplitudeThreshold?: number;
  // ask the DINOv2 service before passing a change the blur calls noise
  dinov2Check?: boolean;
  // largest content distance (0-2, cosine) still treated as noise
  dinov2Threshold?: number;
}

// The blurred difference never exceeds 255, so a threshold near it would pass
// almost any change of one size; half the contrast range is the useful ceiling.
export const MAX_BLUR_AMPLITUDE_THRESHOLD = 128;

// Above the strongest of 57 anti-aliasing-only pairs of real VRT pages (0.133)
// in the research dataset, measured the way Dinov2Service measures.
export const DEFAULT_DINOV2_THRESHOLD = 0.15;
const MAX_DINOV2_THRESHOLD = 2;

/**
 * Splits a parsed config into the filter's settings — absent when it is off —
 * and the config the comparator gets. The config is a JSON string nothing
 * validates on the way in, so a threshold that is not a number in range falls
 * back to the default rather than letting a typo pass everything.
 */
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
  // the threshold was calibrated at this sigma; it is not a setting of its own
  const blurAmplitude: BlurAmplitudeOptions = { sigma: DEFAULT_BLUR_SIGMA, threshold };
  if (dinov2Check === true) {
    blurAmplitude.dinov2 = { threshold: dinov2ThresholdOf(dinov2Threshold, logger) };
  }
  return { blurAmplitude, comparatorConfig: comparatorConfig as T };
}

function dinov2ThresholdOf(value: unknown, logger: Logger): number {
  if (value === undefined) {
    return DEFAULT_DINOV2_THRESHOLD;
  }
  // a distance of 0 would treat every change as content and pass nothing
  if (typeof value === 'number' && value > 0 && value <= MAX_DINOV2_THRESHOLD) {
    return value;
  }
  logger.warn(
    `dinov2Threshold ${JSON.stringify(value)} is not a number above 0 and up to ${MAX_DINOV2_THRESHOLD}, using ${DEFAULT_DINOV2_THRESHOLD}`
  );
  return DEFAULT_DINOV2_THRESHOLD;
}
