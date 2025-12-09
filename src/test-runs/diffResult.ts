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
}
