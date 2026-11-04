import { IgnoreAreaDto } from '../../../test-runs/dto/ignore-area.dto';
import { RawImage, readPair, UnmeasuredReason } from '../../utils';
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
  wantGate: boolean;
}

export interface BlurAmplitudeJobOutput {
  measure: BlurredDifference | null;
  unmeasured?: UnmeasuredReason;
  densest: NoiseRegion[];
  gate?: PatchGate;
}

const DEFAULT_BLUR_SIGMA = 1;

const SOLID_MIN_CHANGE = 6;
const SOLID_KEEP = 0.9;

export const MAX_MEASURED_PIXELS = 16_000_000;

export const DENSITY_WINDOW = 8;
const MAX_DENSEST = 5;

const notMeasured = (unmeasured: UnmeasuredReason): BlurAmplitudeJobOutput => ({
  measure: null,
  unmeasured,
  densest: [],
});

export function looksLikeNoise(measure: BlurredDifference, thresholds: NoiseAnalysisThresholds['blur']): boolean {
  return measure.amplitude <= thresholds.amplitudeThreshold && measure.solidShare <= thresholds.solidShareMax;
}

export function analyseDifference(
  baseline: RawImage,
  image: RawImage,
  thresholds: NoiseAnalysisThresholds['blur'],
  wantGate: boolean
): BlurAmplitudeJobOutput {
  const box = changedBox(baseline, image);
  const measure = measureInBox(baseline, image, box);
  if (!measure) {
    return notMeasured('image too large');
  }
  const densest = box ? windowDensity(baseline, image, box) : [];
  return wantGate && looksLikeNoise(measure, thresholds)
    ? { measure, densest, gate: gateOfDecoded(baseline, image, DINOV2_PATCH) }
    : { measure, densest };
}

export function computeBlurAmplitude(input: BlurAmplitudeJobInput): BlurAmplitudeJobOutput {
  const pair = readPair(input.baseline, input.image, input.ignoreAreas);
  return 'unmeasured' in pair
    ? notMeasured(pair.unmeasured)
    : analyseDifference(pair.baseline, pair.image, input.thresholds, input.wantGate);
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
  { data: a, width, height }: RawImage,
  { data: b }: RawImage,
  { minX, minY, maxX, maxY }: Box
): NoiseRegion[] {
  const windowWidth = Math.min(DENSITY_WINDOW, width);
  const windowHeight = Math.min(DENSITY_WINDOW, height);
  const left = Math.max(0, minX - windowWidth + 1);
  const top = Math.max(0, minY - windowHeight + 1);
  const columns = Math.min(maxX, width - windowWidth) - left + 1;
  const rows = Math.min(maxY, height - windowHeight) - top + 1;
  const spanWidth = columns + windowWidth - 1;
  const spanHeight = rows + windowHeight - 1;

  const changed = new Uint8Array(spanWidth * spanHeight);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (isChanged(a, b, (y * width + x) * 4)) changed[(y - top) * spanWidth + (x - left)] = 1;
    }
  }

  const weights = new Uint8Array(columns * rows);
  const columnSums = new Uint8Array(spanWidth);
  for (let wy = 0; wy < rows; wy++) {
    for (let x = 0; x < spanWidth; x++) {
      if (wy === 0) {
        for (let r = 0; r < windowHeight; r++) columnSums[x] += changed[r * spanWidth + x];
      } else {
        columnSums[x] += changed[(wy + windowHeight - 1) * spanWidth + x] - changed[(wy - 1) * spanWidth + x];
      }
    }
    let sum = 0;
    for (let x = 0; x < windowWidth; x++) sum += columnSums[x];
    weights[wy * columns] = sum;
    for (let wx = 1; wx < columns; wx++) {
      sum += columnSums[wx + windowWidth - 1] - columnSums[wx - 1];
      weights[wy * columns + wx] = sum;
    }
  }

  const densest: NoiseRegion[] = [];
  while (densest.length < MAX_DENSEST) {
    let best = 0;
    let at = -1;
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] > best) {
        best = weights[i];
        at = i;
      }
    }
    if (at < 0) break;
    const wx = at % columns;
    const wy = Math.floor(at / columns);
    densest.push({ x: left + wx, y: top + wy, width: windowWidth, height: windowHeight, weight: best });
    for (let y = Math.max(0, wy - windowHeight + 1); y < Math.min(rows, wy + windowHeight); y++) {
      weights.fill(
        0,
        y * columns + Math.max(0, wx - windowWidth + 1),
        y * columns + Math.min(columns, wx + windowWidth)
      );
    }
  }
  return densest;
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
