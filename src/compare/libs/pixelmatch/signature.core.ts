import { PNG } from 'pngjs';
import Pixelmatch from 'pixelmatch';
import { IgnoreAreaDto } from '../../../test-runs/dto/ignore-area.dto';
import { downscale, RawImage, readSameSizePair } from '../../utils';

export interface SignatureJobInput {
  kind: 'signature';
  baseline: Buffer | Uint8Array;
  image: Buffer | Uint8Array;
  ignoreAreas: IgnoreAreaDto[];
  threshold: number;
  includeAA: boolean;
}

export interface SignatureJobOutput {
  signature: number[] | null;
}

const COLOR_BUCKETS_PER_CHANNEL = 4;

export const SIGNATURE_LENGTH = COLOR_BUCKETS_PER_CHANNEL ** 3;

const SIGNATURE_MAX_DIMENSION = 500;

export const SIGNATURE_SIMILARITY_THRESHOLD = 0.9;

export function computeChangeSignature(input: SignatureJobInput): SignatureJobOutput {
  const pair = readSameSizePair(input.baseline, input.image, input.ignoreAreas);
  return { signature: pair && signatureOfDecoded(pair.baseline, pair.image, input) };
}

export function signatureOfDecoded(
  baselineImage: RawImage,
  checkpointImage: RawImage,
  options: { threshold: number; includeAA: boolean }
): number[] | null {
  const baseline = downscale(baselineImage, SIGNATURE_MAX_DIMENSION);
  const image = downscale(checkpointImage, SIGNATURE_MAX_DIMENSION);
  const { width, height } = baseline;
  const mask = new PNG({ width, height });
  const changedPixels = Pixelmatch(baseline.data, image.data, mask.data, width, height, {
    threshold: options.threshold,
    includeAA: options.includeAA,
    diffMask: true,
  });
  if (changedPixels === 0) {
    return null;
  }

  const bucketSize = 256 / COLOR_BUCKETS_PER_CHANNEL;
  const histogram = new Array(SIGNATURE_LENGTH).fill(0);
  for (let i = 0; i < width * height; i++) {
    if (mask.data[i * 4 + 3] === 0) {
      continue;
    }
    const r = Math.min(COLOR_BUCKETS_PER_CHANNEL - 1, Math.floor(image.data[i * 4] / bucketSize));
    const g = Math.min(COLOR_BUCKETS_PER_CHANNEL - 1, Math.floor(image.data[i * 4 + 1] / bucketSize));
    const b = Math.min(COLOR_BUCKETS_PER_CHANNEL - 1, Math.floor(image.data[i * 4 + 2] / bucketSize));
    histogram[r * COLOR_BUCKETS_PER_CHANNEL * COLOR_BUCKETS_PER_CHANNEL + g * COLOR_BUCKETS_PER_CHANNEL + b]++;
  }

  const total = histogram.reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return null;
  }
  return histogram.map((value) => value / total);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function signaturesMatch(a: number[], b: number[]): boolean {
  return cosineSimilarity(a, b) >= SIGNATURE_SIMILARITY_THRESHOLD;
}
