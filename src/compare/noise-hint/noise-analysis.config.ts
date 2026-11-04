export interface NoiseAnalysisConfig {
  blur: { enabled: boolean; amplitudeThreshold: number; solidShareMax: number };
  dinov2: { enabled: boolean; distanceThreshold: number };
}

export const DEFAULT_NOISE_ANALYSIS_CONFIG: NoiseAnalysisConfig = {
  blur: { enabled: true, amplitudeThreshold: 80, solidShareMax: 0.01 },
  dinov2: { enabled: true, distanceThreshold: 0.15 },
};

type Section = Record<string, unknown>;

const isObject = (value: unknown): value is Section =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const positiveNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

const nonNegativeNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;

const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

const section = (value: unknown): Section => (isObject(value) ? value : {});

export function parseNoiseAnalysisConfig(json: string): NoiseAnalysisConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    raw = null;
  }
  const config = section(raw);
  const blur = section(config.blur);
  const dinov2 = section(config.dinov2);
  const defaults = DEFAULT_NOISE_ANALYSIS_CONFIG;

  return {
    blur: {
      enabled: flag(blur.enabled, defaults.blur.enabled),
      amplitudeThreshold: positiveNumber(blur.amplitudeThreshold, defaults.blur.amplitudeThreshold),
      solidShareMax: nonNegativeNumber(blur.solidShareMax, defaults.blur.solidShareMax),
    },
    dinov2: {
      enabled: flag(dinov2.enabled, defaults.dinov2.enabled),
      distanceThreshold: positiveNumber(dinov2.distanceThreshold, defaults.dinov2.distanceThreshold),
    },
  };
}
