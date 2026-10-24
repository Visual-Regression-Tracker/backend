import { PNG } from 'pngjs';
import { IgnoreAreaDto } from '../../../test-runs/dto/ignore-area.dto';
import { applyIgnoreAreas, RawImage } from '../../utils';

/**
 * Filter for rendering noise, calibrated in research/jepa-screenshot-diff:
 * blurring the difference between two screenshots by a pixel or so makes
 * anti-aliasing and sub-pixel rasterisation differences — single pixels
 * flipping, edges landing a fraction of a pixel over — average out to a weak
 * change, while anything a person would notice (a letter, an icon, a moved
 * block) keeps most of its contrast.
 *
 * The blur cannot tell a faint change that is *solid* — a panel turned light
 * grey — from noise by its strength alone: blurring a uniform patch leaves it
 * as it is. So the pixels the blur does not attenuate are counted too, and a
 * change with many of them is never noise.
 */
export interface BlurAmplitudeOptions {
  // Gaussian sigma in pixels
  sigma: number;
  // strongest blurred colour-channel difference (0-255) still treated as
  // rendering noise
  threshold: number;
  // a second look at what the blur would pass (see dinov2/dinov2.service.ts):
  // largest content distance between the two screenshots still treated as noise
  dinov2?: { threshold: number };
}

export interface BlurredDifference {
  // strongest blurred colour-channel difference, 0-255
  amplitude: number;
  // pixels whose change the blur leaves (nearly) intact: a solid change
  solidPixels: number;
  // the same as a share of the screenshot, 0-1
  solidShare: number;
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
  // null when there is nothing to measure: unreadable bytes, different sizes,
  // or a change too large to measure within bounds
  measure: BlurredDifference | null;
}

export const DEFAULT_BLUR_SIGMA = 1;
// Above the strongest of 57 anti-aliasing-only pairs of real VRT pages (75.1)
// in the research dataset; at this value 72% of the injected bugs still fail.
export const DEFAULT_BLUR_AMPLITUDE_THRESHOLD = 80;

// A pixel counts as solid when its change is at least this many levels and the
// blur keeps at least this share of it. Sub-pixel shifts of large flat shapes
// make up to 0.7% of a page solid in the research dataset (6,300 of 1280x720);
// a panel turning #e0e0e0 makes 19%. Taken as a share of the screenshot, so it
// holds for a small component and a tall page alike.
const SOLID_MIN_CHANGE = 6;
const SOLID_KEEP = 0.9;
export const MAX_SOLID_SHARE = 0.01;

// Beyond this many pixels in the changed area, measuring would cost seconds
// and hundreds of megabytes in a worker; the comparator's verdict stands.
export const MAX_MEASURED_PIXELS = 16_000_000;

/** The filter's verdict: true only for a measured change no stronger than noise. */
export function isRenderingNoise(measure: BlurredDifference | null, threshold: number): boolean {
  return measure !== null && measure.amplitude <= threshold && measure.solidShare <= MAX_SOLID_SHARE;
}

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
    return { measure: null };
  }
  if (baseline.width !== image.width || baseline.height !== image.height) {
    return { measure: null };
  }
  applyIgnoreAreas(baseline, input.ignoreAreas);
  applyIgnoreAreas(image, input.ignoreAreas);
  return { measure: measureBlurredDifference(baseline, image, input.sigma) };
}

// Same truncation as scipy.ndimage.gaussian_filter, which the research
// prototype used: the kernel reaches out four sigmas.
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

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// the bounding box of every pixel that differs at all, or null when none does
function changedBox({ data: a, width, height }: RawImage, { data: b }: RawImage): Box | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      // equal bytes are the overwhelming case and need no blending to compare
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

// For each position from `from - radius` to `to + radius`, the index into the
// box it reads once mirrored at the image border, or -1 outside the box (where
// the difference is zero).
function sourceIndex(from: number, to: number, radius: number, size: number, boxMin: number, boxMax: number) {
  const index = new Int32Array(to - from + 1 + 2 * radius);
  for (let i = 0; i < index.length; i++) {
    const source = reflect(from - radius + i, size);
    index[i] = source < boxMin || source > boxMax ? -1 : source - boxMin;
  }
  return index;
}

/**
 * The strongest Gaussian-blurred difference between two images of equal size,
 * per colour channel — so a change of hue at equal brightness is not mistaken
 * for noise — and how many pixels the blur leaves intact. Blurring is linear,
 * so the difference is blurred rather than each image, and only around the box
 * where it is non-zero. Null when that box is too large to measure.
 */
export function measureBlurredDifference(baseline: RawImage, image: RawImage, sigma: number): BlurredDifference | null {
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

  const kernel = gaussianKernel(sigma);
  const radius = (kernel.length - 1) / 2;
  // where the blurred difference can be non-zero
  const left = Math.max(0, minX - radius);
  const right = Math.min(width - 1, maxX + radius);
  const top = Math.max(0, minY - radius);
  const bottom = Math.min(height - 1, maxY + radius);
  const regionWidth = right - left + 1;
  const columns = sourceIndex(left, right, radius, width, minX, maxX);
  const rowsOf = sourceIndex(top, bottom, radius, height, minY, maxY);

  // shared by the three channels: one set of buffers, not three
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

    // horizontal pass, over the box's rows only: the others blur to zero
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

    // vertical pass, keeping the extreme and marking what the blur left intact
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
