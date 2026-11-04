import { isJsonObject } from '../../utils';

export type NoiseVerdict = 'noise' | 'change' | 'unknown';

export type NoiseUnknownReason = 'sizes differ' | 'no diff' | 'image too large';

export interface NoiseRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  weight: number;
}

export interface NoiseAnalysisThresholds {
  blur: { amplitudeThreshold: number; solidShareMax: number };
  dinov2: { distanceThreshold: number };
}

export interface BlurStageResult {
  verdict: 'noise' | 'change';
  score: number;
  signals: { amplitude: number; solidShare: number; density: number };
  regions: NoiseRegion[];
}

export interface Dinov2StageResult {
  verdict: 'noise' | 'change';
  score: number;
  signals: { distance: number; patches: number };
  regions: NoiseRegion[];
}

export interface Dinov2StageSkipped {
  skipped: 'blur sees a change' | 'off';
}

export interface Dinov2StageError {
  error: 'dinov2 unavailable';
}

export type Dinov2Stage = Dinov2StageResult | Dinov2StageSkipped | Dinov2StageError;

export interface NoiseAnalysisResult {
  version: number;
  verdict: NoiseVerdict;
  score: number | null;
  reason: NoiseUnknownReason | null;
  config: NoiseAnalysisThresholds;
  blur: BlurStageResult | null;
  dinov2: Dinov2Stage | null;
  computedAt: string;
}

export interface NoiseAnalysisPending {
  pending: true;
  requestedAt: string;
}

export type TestRunNoiseAnalysis = NoiseAnalysisResult | NoiseAnalysisPending;

export function readNoiseAnalysis(json: unknown): TestRunNoiseAnalysis | null {
  if (!isJsonObject(json)) {
    return null;
  }
  if (json.pending === true) {
    return typeof json.requestedAt === 'string' ? { pending: true, requestedAt: json.requestedAt } : null;
  }
  return json as unknown as NoiseAnalysisResult;
}
