import { isJsonObject } from '../../utils';
import { NoiseAnalysisThresholds } from './noise-analysis.types';

export interface NoiseAnalysisConfig {
  blur: { enabled: boolean };
  dinov2: { enabled: boolean };
}

export const DEFAULT_NOISE_ANALYSIS_CONFIG: NoiseAnalysisConfig = {
  blur: { enabled: false },
  dinov2: { enabled: false },
};

export const NOISE_ANALYSIS_THRESHOLDS: NoiseAnalysisThresholds = {
  blur: { amplitudeThreshold: 80, solidShareMax: 0.01 },
  dinov2: { distanceThreshold: 0.15 },
};

const flag = (value: unknown): boolean => value === true;

const section = (value: unknown): Record<string, unknown> => (isJsonObject(value) ? value : {});

export function parseNoiseAnalysisConfig(json: string): NoiseAnalysisConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    raw = null;
  }
  const config = section(raw);
  return {
    blur: { enabled: flag(section(config.blur).enabled) },
    dinov2: { enabled: flag(section(config.dinov2).enabled) },
  };
}
