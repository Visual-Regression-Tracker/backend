import { isJsonObject } from '../../utils';
import {
  BlurStageResult,
  Dinov2Stage,
  Dinov2StageError,
  Dinov2StageResult,
  Dinov2StageSkipped,
  NoiseAnalysisPending,
  NoiseAnalysisResult,
  NoiseRegion,
  readNoiseAnalysis,
} from './noise-analysis.types';

export interface NoiseAnalysisSummary extends Omit<NoiseAnalysisResult, 'blur' | 'dinov2'> {
  blur: Omit<BlurStageResult, 'regions'> | null;
  dinov2: Omit<Dinov2StageResult, 'regions'> | Dinov2StageSkipped | Dinov2StageError | null;
}

export type TestRunNoiseAnalysisSummary = NoiseAnalysisSummary | NoiseAnalysisPending;

const dropRegions = <T extends { regions: NoiseRegion[] }>(stage: T): Omit<T, 'regions'> => {
  const { regions: _regions, ...rest } = stage;
  return rest;
};

const dropDinov2Regions = (stage: Dinov2Stage | null): NoiseAnalysisSummary['dinov2'] =>
  isJsonObject(stage) && 'regions' in stage ? dropRegions(stage as Dinov2StageResult) : stage;

export function withoutRegions(json: unknown): TestRunNoiseAnalysisSummary | null {
  const analysis = readNoiseAnalysis(json);
  if (!analysis) {
    return null;
  }
  if ('pending' in analysis) {
    return analysis;
  }
  return {
    ...analysis,
    blur: isJsonObject(analysis.blur) ? dropRegions(analysis.blur as BlurStageResult) : analysis.blur,
    dinov2: dropDinov2Regions(analysis.dinov2),
  };
}
