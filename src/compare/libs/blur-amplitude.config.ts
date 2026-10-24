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
}

// The blurred difference never exceeds 255, so a threshold near it would pass
// almost any change of one size; half the contrast range is the useful ceiling.
export const MAX_BLUR_AMPLITUDE_THRESHOLD = 128;

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
  const { blurAmplitudeFilter, blurAmplitudeThreshold, ...comparatorConfig } = config;
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
  return { blurAmplitude: { sigma: DEFAULT_BLUR_SIGMA, threshold }, comparatorConfig: comparatorConfig as T };
}
