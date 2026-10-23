import { TestStatus } from '@prisma/client';

/**
 * A signature and the comparison settings it was computed under. A signature
 * only means anything under its own threshold, so comparing one taken at a
 * different setting quietly makes grouping worse — the settings travel with it
 * so a stored one can be discarded when the project's config moves on.
 */
export interface StampedSignature {
  threshold: number;
  includeAA: boolean;
  signature: number[];
}

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
   * pass that produced the diff, carrying the settings it was produced under.
   * Stored on the run so the variations dialog can group a screen's locales
   * without decoding their screenshots all over again. Absent when nothing
   * changed, when the dimensions differ, or when the comparison was not
   * pixelmatch.
   */
  changeSignature?: StampedSignature;
  /**
   * Names the small copies of the checkpoint and the diff were saved under, for
   * the card grids to draw instead of the full-size files. Absent when the
   * comparison produced no diff, or was not pixelmatch.
   */
  imageThumbnailName?: string;
  diffThumbnailName?: string;
}
