import { PNG } from 'pngjs';
import Pixelmatch from 'pixelmatch';
import { IgnoreAreaDto } from '../../../test-runs/dto/ignore-area.dto';
import { applyIgnoreAreas } from '../../utils';

/**
 * CPU-bound part of "do these two screens carry the same change?": PNG decode,
 * downscale, pixelmatch and histogram. Extracted so it can run inside a worker
 * thread (see pixelmatch.worker.ts / DiffWorkerPool) — the variations dialog
 * asks for one of these per sibling, and decoding full-size screenshots on the
 * main thread froze the whole API for as long as it took. All input/output must
 * stay structured-clone serializable.
 */
export interface SignatureJobInput {
  kind: 'signature';
  // PNG bytes, not decoded pixels: decoding is the expensive part and belongs
  // in the worker.
  baseline: Buffer | Uint8Array;
  image: Buffer | Uint8Array;
  ignoreAreas: IgnoreAreaDto[];
  threshold: number;
  includeAA: boolean;
}

export interface SignatureJobOutput {
  signature: number[] | null;
}

// Colors are quantized to this many levels per RGB channel, giving
// COLOR_BUCKETS_PER_CHANNEL^3 histogram buckets.
const COLOR_BUCKETS_PER_CHANNEL = 4;

// Longest side (px) images are downscaled to before computing the color
// signature — keeps the histogram representative while cutting pixelmatch cost.
const SIGNATURE_MAX_DIMENSION = 500;

// Two changes are considered the same pattern when their color signatures'
// cosine similarity is at least this value.
export const SIGNATURE_SIMILARITY_THRESHOLD = 0.9;

interface RawImage {
  data: Buffer;
  width: number;
  height: number;
}

// postMessage turns Buffers into Uint8Array views over their own ArrayBuffer.
function toBuffer(data: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

// Nearest-neighbour downscale so the longest side is at most maxDimension.
// Returns the original when already small enough.
function downscale(source: RawImage, maxDimension: number): RawImage {
  const scale = maxDimension / Math.max(source.width, source.height);
  if (scale >= 1) {
    return source;
  }
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const data: Buffer = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(source.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(source.width - 1, Math.floor(x / scale));
      const sourceIndex = (sourceY * source.width + sourceX) * 4;
      const targetIndex = (y * width + x) * 4;
      data[targetIndex] = source.data[sourceIndex];
      data[targetIndex + 1] = source.data[sourceIndex + 1];
      data[targetIndex + 2] = source.data[sourceIndex + 2];
      data[targetIndex + 3] = source.data[sourceIndex + 3];
    }
  }
  return { data, width, height };
}

/**
 * Position-independent signature of a change: a normalized histogram of the
 * colors that the changed pixels take in the new image. Because it ignores
 * *where* the change is, it is robust to per-locale layout shifts (a title
 * wrapping to a different number of lines, options moving down, etc.) while
 * still capturing *what* changed (a selection highlight, a recolored button).
 * Null when there is nothing to compare: unreadable bytes, differing
 * dimensions, or no change outside the ignore areas.
 */
export function computeChangeSignature(input: SignatureJobInput): SignatureJobOutput {
  // A corrupt or truncated screenshot is one candidate the reviewer cannot be
  // offered, not a failed request: the siblings are signed in a single
  // fan-out, so throwing here would take the whole variations dialog down.
  let baselineImage: PNG;
  let checkpointImage: PNG;
  try {
    baselineImage = PNG.sync.read(toBuffer(input.baseline));
    checkpointImage = PNG.sync.read(toBuffer(input.image));
  } catch {
    return { signature: null };
  }

  if (baselineImage.width !== checkpointImage.width || baselineImage.height !== checkpointImage.height) {
    return { signature: null };
  }

  // Masked regions must not count toward the signature, so they are blanked at
  // full resolution — the areas are given in full-resolution coordinates —
  // before the downscale makes both images cheap to compare.
  applyIgnoreAreas(baselineImage, input.ignoreAreas);
  applyIgnoreAreas(checkpointImage, input.ignoreAreas);

  const baseline = downscale(baselineImage, SIGNATURE_MAX_DIMENSION);
  const image = downscale(checkpointImage, SIGNATURE_MAX_DIMENSION);
  const { width, height } = baseline;
  const mask = new PNG({ width, height });
  const changedPixels = Pixelmatch(baseline.data, image.data, mask.data, width, height, {
    threshold: input.threshold,
    includeAA: input.includeAA,
    diffMask: true,
  });
  if (changedPixels === 0) {
    return { signature: null };
  }

  const bucketSize = 256 / COLOR_BUCKETS_PER_CHANNEL;
  const histogram = new Array(COLOR_BUCKETS_PER_CHANNEL ** 3).fill(0);
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
    return { signature: null };
  }
  return { signature: histogram.map((value) => value / total) };
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
