import { TestStatus } from '@prisma/client';

export interface DiffResult {
  status: TestStatus;
  diffName: string;
  pixelMisMatchCount: number;
  diffPercent: number;
  isSameDimension: boolean;
  /**
   * Optional array of analysis insights (e.g., from VLM or other AI services)
   * Each string represents a distinct observation or difference
   * Can be displayed as bullet points in UI
   */
  vlmDescription?: string;
  /**
   * Position-independent colour signature of the change, produced by the same
   * pass that produced the diff. Stored on the run so the variations dialog can
   * group a screen's locales without decoding their screenshots all over again.
   * Absent when nothing changed, when the dimensions differ, or when the
   * comparison was not pixelmatch.
   */
  changeSignature?: number[];
}
