import { Logger } from '@nestjs/common';
import { DEFAULT_BLUR_AMPLITUDE_THRESHOLD, DEFAULT_BLUR_SIGMA } from './pixelmatch/blur-amplitude.core';
import { MAX_BLUR_AMPLITUDE_THRESHOLD, splitBlurAmplitudeConfig } from './blur-amplitude.config';
import { PixelmatchConfig } from './pixelmatch/pixelmatch.types';

describe('splitBlurAmplitudeConfig', () => {
  const logger = { warn: jest.fn() } as unknown as Logger;

  beforeEach(() => jest.mocked(logger.warn).mockClear());

  it('leaves the filter off when the config does not mention it', () => {
    const config: PixelmatchConfig = { threshold: 0.1, ignoreAntialiasing: true };

    const { blurAmplitude, comparatorConfig } = splitBlurAmplitudeConfig(config, logger);

    expect(blurAmplitude).toBeUndefined();
    expect(comparatorConfig).toEqual(config);
  });

  it('turns it on at the default threshold', () => {
    const { blurAmplitude } = splitBlurAmplitudeConfig({ blurAmplitudeFilter: true }, logger);

    expect(blurAmplitude).toEqual({ sigma: DEFAULT_BLUR_SIGMA, threshold: DEFAULT_BLUR_AMPLITUDE_THRESHOLD });
  });

  // anything near 255 would pass almost every change of one size
  it('accepts a threshold up to half the contrast range', () => {
    const { blurAmplitude } = splitBlurAmplitudeConfig(
      { blurAmplitudeFilter: true, blurAmplitudeThreshold: MAX_BLUR_AMPLITUDE_THRESHOLD },
      logger
    );

    expect(MAX_BLUR_AMPLITUDE_THRESHOLD).toBe(128);
    expect(blurAmplitude.threshold).toBe(128);
  });

  it("uses the config's threshold", () => {
    const { blurAmplitude } = splitBlurAmplitudeConfig(
      { blurAmplitudeFilter: true, blurAmplitudeThreshold: 60.5 },
      logger
    );

    expect(blurAmplitude).toEqual({ sigma: DEFAULT_BLUR_SIGMA, threshold: 60.5 });
  });

  // the config is a JSON string nothing validates on the way in; only a real
  // `true` turns on something that can pass runs
  it.each([['true'], [1], [false]])('stays off for blurAmplitudeFilter %p', (value) => {
    expect(splitBlurAmplitudeConfig({ blurAmplitudeFilter: value as boolean }, logger).blurAmplitude).toBeUndefined();
  });

  it.each([['80'], [Number.NaN], [-1], [129], [null]])(
    'falls back to the default threshold for %p, and says so',
    (value) => {
      const { blurAmplitude } = splitBlurAmplitudeConfig(
        { blurAmplitudeFilter: true, blurAmplitudeThreshold: value as number },
        logger
      );

      expect(blurAmplitude.threshold).toBe(DEFAULT_BLUR_AMPLITUDE_THRESHOLD);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    }
  );

  // the keys are CompareService's, not the library's: looks-same, odiff and the
  // VLM providers get their options passed straight through
  it("keeps the filter's keys out of the comparator's config", () => {
    const { comparatorConfig } = splitBlurAmplitudeConfig(
      { strict: false, blurAmplitudeFilter: false, blurAmplitudeThreshold: 70 },
      logger
    );

    expect(comparatorConfig).toEqual({ strict: false });
  });
});
