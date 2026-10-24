import { PNG } from 'pngjs';
import { IgnoreAreaDto } from '../../../test-runs/dto/ignore-area.dto';
import { applyIgnoreAreas, RawImage } from '../../utils';

/**
 * Prototype filter for rendering noise, calibrated in
 * research/jepa-screenshot-diff: blurring both screenshots by a pixel or so
 * makes anti-aliasing and sub-pixel rasterisation differences — single pixels
 * flipping, edges landing a pixel over — average out to a weak change, while
 * anything a person would notice (a letter, an icon, a moved block) keeps most
 * of its contrast. The strongest blurred difference is therefore a cheap
 * measure of how visible the change is.
 */
export interface BlurAmplitudeOptions {
  // Gaussian sigma in pixels
  sigma: number;
  // strongest blurred colour-channel difference (0-255) still treated as
  // rendering noise
  threshold: number;
}

/**
 * The worker-pool job CompareService runs for comparators that do not apply the
 * filter in their own pass (looks-same, odiff). PNG bytes in, because decoding
 * is the expensive part and belongs off the event loop; all input/output must
 * stay structured-clone serializable.
 */
export interface BlurAmplitudeJobInput {
  kind: 'blur-amplitude';
  baseline: Buffer | Uint8Array;
  image: Buffer | Uint8Array;
  ignoreAreas: IgnoreAreaDto[];
  sigma: number;
}

export interface BlurAmplitudeJobOutput {
  // null when there is nothing to measure: unreadable bytes or different sizes
  amplitude: number | null;
}

export const DEFAULT_BLUR_SIGMA = 1;
// Above the strongest of 57 anti-aliasing-only pairs of real VRT pages (75.1)
// in the research dataset; at this value 72% of the injected bugs still fail.
export const DEFAULT_BLUR_AMPLITUDE_THRESHOLD = 80;

// postMessage turns Buffers into Uint8Array views over their own ArrayBuffer.
function toBuffer(data: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

export function computeBlurAmplitude(input: BlurAmplitudeJobInput): BlurAmplitudeJobOutput {
  // The caller keeps the comparator's verdict when this has no answer, so a
  // corrupt screenshot costs the filter, not the upload.
  let baseline: PNG;
  let image: PNG;
  try {
    baseline = PNG.sync.read(toBuffer(input.baseline));
    image = PNG.sync.read(toBuffer(input.image));
  } catch {
    return { amplitude: null };
  }
  if (baseline.width !== image.width || baseline.height !== image.height) {
    return { amplitude: null };
  }
  applyIgnoreAreas(baseline, input.ignoreAreas);
  applyIgnoreAreas(image, input.ignoreAreas);
  return { amplitude: maxBlurredDifference(baseline, image, input.sigma) };
}

// Same truncation as scipy.ndimage.gaussian_filter, which the research
// prototype used: the kernel reaches out four sigmas.
function gaussianKernel(sigma: number): Float64Array {
  const radius = Math.floor(4 * sigma + 0.5);
  const kernel = new Float64Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    kernel[i + radius] = Math.exp((-i * i) / (2 * sigma * sigma));
    sum += kernel[i + radius];
  }
  return kernel.map((weight) => weight / sum);
}

// Mirrors an index at the image border (scipy's 'reflect': -1 -> 0, n -> n-1),
// so a change in a corner is not diluted by an imaginary blank margin.
function reflect(index: number, size: number): number {
  const period = 2 * size;
  const wrapped = ((index % period) + period) % period;
  return wrapped < size ? wrapped : period - 1 - wrapped;
}

// A colour channel of a pixel over white, the way pixelmatch reads
// transparency: the ignore areas are blanked to transparent black and must look
// like nothing.
function channel(data: Buffer | Uint8Array, offset: number, rgb: number): number {
  return 255 + (data[offset + rgb] - 255) * (data[offset + 3] / 255);
}

/**
 * The largest absolute difference between the two images' Gaussian-blurred
 * colour channels. Taken per channel rather than on luma, so a change of hue at
 * equal brightness — a red button turned grey — is not mistaken for noise; on
 * grey text, where anti-aliasing mostly lives, the two are the same.
 */
export function maxBlurredDifference(baseline: RawImage, image: RawImage, sigma: number): number {
  const { width, height } = baseline;
  if (image.width !== width || image.height !== height) {
    throw new Error(`Cannot blur-compare ${width}x${height} with ${image.width}x${image.height}`);
  }
  const box = changedBox(baseline, image);
  if (!box) {
    return 0;
  }
  const kernel = gaussianKernel(sigma);
  return Math.max(...[0, 1, 2].map((rgb) => blurredChannelMax(baseline, image, rgb, box, kernel)));
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// the bounding box of every pixel that differs at all, or null when none does
function changedBox(baseline: RawImage, image: RawImage): Box | null {
  const { width, height } = baseline;
  const box: Box = { minX: width, minY: height, maxX: -1, maxY: -1 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if ([0, 1, 2].some((rgb) => channel(baseline.data, offset, rgb) !== channel(image.data, offset, rgb))) {
        box.minX = Math.min(box.minX, x);
        box.maxX = Math.max(box.maxX, x);
        box.minY = Math.min(box.minY, y);
        box.maxY = Math.max(box.maxY, y);
      }
    }
  }
  return box.maxX < 0 ? null : box;
}

/**
 * Blurring is linear, so the difference is blurred instead of each image, and
 * only around the box where it is non-zero: everywhere else it is zero.
 */
function blurredChannelMax(baseline: RawImage, image: RawImage, rgb: number, box: Box, kernel: Float64Array): number {
  const { width, height } = baseline;
  const { minX, minY, maxX, maxY } = box;

  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  const difference = new Float64Array(boxWidth * boxHeight);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const offset = (y * width + x) * 4;
      difference[(y - minY) * boxWidth + (x - minX)] =
        channel(baseline.data, offset, rgb) - channel(image.data, offset, rgb);
    }
  }
  const differenceAt = (x: number, y: number): number =>
    x < minX || x > maxX || y < minY || y > maxY ? 0 : difference[(y - minY) * boxWidth + (x - minX)];

  const radius = (kernel.length - 1) / 2;
  // where the blurred difference can be non-zero
  const left = Math.max(0, minX - radius);
  const right = Math.min(width - 1, maxX + radius);
  const top = Math.max(0, minY - radius);
  const bottom = Math.min(height - 1, maxY + radius);
  const regionWidth = right - left + 1;

  // horizontal pass; rows outside the box blur to zero and are never read
  const rows = new Float64Array(regionWidth * boxHeight);
  for (let y = minY; y <= maxY; y++) {
    for (let x = left; x <= right; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += kernel[k + radius] * differenceAt(reflect(x + k, width), y);
      }
      rows[(y - minY) * regionWidth + (x - left)] = sum;
    }
  }
  const rowAt = (x: number, y: number): number =>
    y < minY || y > maxY ? 0 : rows[(y - minY) * regionWidth + (x - left)];

  // vertical pass, keeping only the extreme
  let strongest = 0;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += kernel[k + radius] * rowAt(x, reflect(y + k, height));
      }
      strongest = Math.max(strongest, Math.abs(sum));
    }
  }
  return strongest;
}
