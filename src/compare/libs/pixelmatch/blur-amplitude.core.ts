import { IgnoreAreaDto } from '../../../test-runs/dto/ignore-area.dto';
import { RawImage, readSameSizePair } from '../../utils';
import { DINOV2_PATCH, gateOfDecoded, PatchGate } from './patch-gate.core';

export interface BlurAmplitudeOptions {
  threshold: number;
  dinov2?: { threshold: number };
}

export interface BlurredDifference {
  amplitude: number;
  solidPixels: number;
  solidShare: number;
}

export interface BlurAmplitudeJobInput {
  kind: 'blur-amplitude';
  baseline: Buffer | Uint8Array;
  image: Buffer | Uint8Array;
  ignoreAreas: IgnoreAreaDto[];
  gateIfNoise?: { threshold: number };
}

export interface BlurAmplitudeJobOutput {
  measure: BlurredDifference | null;
  gate?: PatchGate;
}

export const DEFAULT_BLUR_SIGMA = 1;
// strongest of 57 anti-aliasing-only real pairs: 75.1; 72% of injected bugs still fail
export const DEFAULT_BLUR_AMPLITUDE_THRESHOLD = 80;

// solid share: sub-pixel shifts up to 0.7%, #e0e0e0 panel 19%
const SOLID_MIN_CHANGE = 6;
const SOLID_KEEP = 0.9;
export const MAX_SOLID_SHARE = 0.01;

export const MAX_MEASURED_PIXELS = 16_000_000;

export function isRenderingNoise(measure: BlurredDifference | null, threshold: number): boolean {
  return measure !== null && measure.amplitude <= threshold && measure.solidShare <= MAX_SOLID_SHARE;
}

export function computeBlurAmplitude(input: BlurAmplitudeJobInput): BlurAmplitudeJobOutput {
  const pair = readSameSizePair(input.baseline, input.image, input.ignoreAreas);
  const measure = pair && measureBlurredDifference(pair.baseline, pair.image);
  const gate =
    pair && input.gateIfNoise && isRenderingNoise(measure, input.gateIfNoise.threshold)
      ? gateOfDecoded(pair.baseline, pair.image, DINOV2_PATCH)
      : undefined;
  return { measure, ...(gate ? { gate } : {}) };
}

function gaussianKernel(sigma: number): Float32Array {
  const radius = Math.floor(4 * sigma + 0.5);
  const kernel = new Float64Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    kernel[i + radius] = Math.exp((-i * i) / (2 * sigma * sigma));
    sum += kernel[i + radius];
  }
  return Float32Array.from(kernel, (weight) => weight / sum);
}

function reflect(index: number, size: number): number {
  const period = 2 * size;
  const wrapped = ((index % period) + period) % period;
  return wrapped < size ? wrapped : period - 1 - wrapped;
}

function channel(data: Buffer | Uint8Array, offset: number, rgb: number): number {
  return 255 + (data[offset + rgb] - 255) * (data[offset + 3] / 255);
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function changedBox({ data: a, width, height }: RawImage, { data: b }: RawImage): Box | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (a[o] === b[o] && a[o + 1] === b[o + 1] && a[o + 2] === b[o + 2] && a[o + 3] === b[o + 3]) {
        continue;
      }
      if (
        channel(a, o, 0) === channel(b, o, 0) &&
        channel(a, o, 1) === channel(b, o, 1) &&
        channel(a, o, 2) === channel(b, o, 2)
      ) {
        continue;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

function sourceIndex(from: number, to: number, radius: number, size: number, boxMin: number, boxMax: number) {
  const index = new Int32Array(to - from + 1 + 2 * radius);
  for (let i = 0; i < index.length; i++) {
    const source = reflect(from - radius + i, size);
    index[i] = source < boxMin || source > boxMax ? -1 : source - boxMin;
  }
  return index;
}

export function measureBlurredDifference(baseline: RawImage, image: RawImage): BlurredDifference | null {
  const { width, height } = baseline;
  if (image.width !== width || image.height !== height) {
    throw new Error(`Cannot blur-compare ${width}x${height} with ${image.width}x${image.height}`);
  }
  const box = changedBox(baseline, image);
  if (!box) {
    return { amplitude: 0, solidPixels: 0, solidShare: 0 };
  }
  const { minX, minY, maxX, maxY } = box;
  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  if (boxWidth * boxHeight > MAX_MEASURED_PIXELS) {
    return null;
  }

  const kernel = gaussianKernel(DEFAULT_BLUR_SIGMA);
  const radius = (kernel.length - 1) / 2;
  const left = Math.max(0, minX - radius);
  const right = Math.min(width - 1, maxX + radius);
  const top = Math.max(0, minY - radius);
  const bottom = Math.min(height - 1, maxY + radius);
  const regionWidth = right - left + 1;
  const columns = sourceIndex(left, right, radius, width, minX, maxX);
  const rowsOf = sourceIndex(top, bottom, radius, height, minY, maxY);

  const difference = new Float32Array(boxWidth * boxHeight);
  const rows = new Float32Array(regionWidth * boxHeight);
  const solid = new Uint8Array(boxWidth * boxHeight);
  let amplitude = 0;

  for (let rgb = 0; rgb < 3; rgb++) {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const o = (y * width + x) * 4;
        difference[(y - minY) * boxWidth + (x - minX)] = channel(baseline.data, o, rgb) - channel(image.data, o, rgb);
      }
    }

    for (let by = 0; by < boxHeight; by++) {
      const rowStart = by * boxWidth;
      for (let rx = 0; rx < regionWidth; rx++) {
        let sum = 0;
        for (let k = 0; k < kernel.length; k++) {
          const source = columns[rx + k];
          if (source >= 0) sum += kernel[k] * difference[rowStart + source];
        }
        rows[by * regionWidth + rx] = sum;
      }
    }

    for (let ry = 0; ry <= bottom - top; ry++) {
      const y = top + ry;
      const insideBox = y >= minY && y <= maxY;
      for (let rx = 0; rx < regionWidth; rx++) {
        let sum = 0;
        for (let k = 0; k < kernel.length; k++) {
          const source = rowsOf[ry + k];
          if (source >= 0) sum += kernel[k] * rows[source * regionWidth + rx];
        }
        const blurred = Math.abs(sum);
        if (blurred > amplitude) amplitude = blurred;

        const x = left + rx;
        if (insideBox && x >= minX && x <= maxX) {
          const at = (y - minY) * boxWidth + (x - minX);
          const raw = Math.abs(difference[at]);
          if (raw >= SOLID_MIN_CHANGE && blurred >= SOLID_KEEP * raw) solid[at] = 1;
        }
      }
    }
  }

  let solidPixels = 0;
  for (let i = 0; i < solid.length; i++) solidPixels += solid[i];
  return { amplitude, solidPixels, solidShare: solidPixels / (width * height) };
}
