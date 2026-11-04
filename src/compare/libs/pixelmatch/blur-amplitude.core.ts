import { IgnoreAreaDto } from '../../../test-runs/dto/ignore-area.dto';
import { RawImage, readSameSizePair } from '../../utils';
import { NoiseAnalysisThresholds, NoiseRegion } from '../../noise-hint/noise-analysis.types';
import { DINOV2_PATCH, gateOfDecoded, PatchGate } from './patch-gate.core';

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
  thresholds: NoiseAnalysisThresholds['blur'];
}

export interface BlurAmplitudeJobOutput {
  measure: BlurredDifference | null;
  density: number;
  densest: NoiseRegion[];
  gate?: PatchGate;
}

const DEFAULT_BLUR_SIGMA = 1;

const SOLID_MIN_CHANGE = 6;
const SOLID_KEEP = 0.9;

export const MAX_MEASURED_PIXELS = 16_000_000;

export const DENSITY_WINDOW = 8;
const MAX_DENSEST = 5;

const notMeasured = (): BlurAmplitudeJobOutput => ({ measure: null, density: 0, densest: [] });

export function analyseDifference(
  baseline: RawImage,
  image: RawImage,
  thresholds: BlurAmplitudeJobInput['thresholds']
): BlurAmplitudeJobOutput {
  const box = changedBox(baseline, image);
  const measure = measureInBox(baseline, image, box);
  if (!measure) {
    return notMeasured();
  }
  const { density, densest } = box ? windowDensity(baseline, image, box) : { density: 0, densest: [] };
  const looksLikeNoise =
    measure.amplitude <= thresholds.amplitudeThreshold && measure.solidShare <= thresholds.solidShareMax;
  return looksLikeNoise
    ? { measure, density, densest, gate: gateOfDecoded(baseline, image, DINOV2_PATCH) }
    : { measure, density, densest };
}

export function computeBlurAmplitude(input: BlurAmplitudeJobInput): BlurAmplitudeJobOutput {
  const pair = readSameSizePair(input.baseline, input.image, input.ignoreAreas);
  return pair ? analyseDifference(pair.baseline, pair.image, input.thresholds) : notMeasured();
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

function isChanged(a: Buffer | Uint8Array, b: Buffer | Uint8Array, o: number): boolean {
  if (a[o] === b[o] && a[o + 1] === b[o + 1] && a[o + 2] === b[o + 2] && a[o + 3] === b[o + 3]) {
    return false;
  }
  return (
    channel(a, o, 0) !== channel(b, o, 0) ||
    channel(a, o, 1) !== channel(b, o, 1) ||
    channel(a, o, 2) !== channel(b, o, 2)
  );
}

function changedBox({ data: a, width, height }: RawImage, { data: b }: RawImage): Box | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isChanged(a, b, (y * width + x) * 4)) {
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

function windowDensity(
  { data: a, width }: RawImage,
  { data: b }: RawImage,
  { minX, minY, maxX, maxY }: Box
): { density: number; densest: NoiseRegion[] } {
  const firstColumn = Math.floor(minX / DENSITY_WINDOW);
  const firstRow = Math.floor(minY / DENSITY_WINDOW);
  const columns = Math.floor(maxX / DENSITY_WINDOW) - firstColumn + 1;
  const rows = Math.floor(maxY / DENSITY_WINDOW) - firstRow + 1;
  const counts = new Uint8Array(columns * rows);
  for (let y = minY; y <= maxY; y++) {
    const rowStart = (Math.floor(y / DENSITY_WINDOW) - firstRow) * columns - firstColumn;
    for (let x = minX; x <= maxX; x++) {
      if (isChanged(a, b, (y * width + x) * 4)) counts[rowStart + Math.floor(x / DENSITY_WINDOW)]++;
    }
  }

  const windows: NoiseRegion[] = [];
  counts.forEach((weight, at) => {
    if (weight > 0) {
      windows.push({
        x: (firstColumn + (at % columns)) * DENSITY_WINDOW,
        y: (firstRow + Math.floor(at / columns)) * DENSITY_WINDOW,
        width: DENSITY_WINDOW,
        height: DENSITY_WINDOW,
        weight,
      });
    }
  });
  windows.sort((p, q) => q.weight - p.weight || p.y - q.y || p.x - q.x);
  return { density: windows[0]?.weight ?? 0, densest: windows.slice(0, MAX_DENSEST) };
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
  return measureInBox(baseline, image, changedBox(baseline, image));
}

function measureInBox(baseline: RawImage, image: RawImage, box: Box | null): BlurredDifference | null {
  const { width, height } = baseline;
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
