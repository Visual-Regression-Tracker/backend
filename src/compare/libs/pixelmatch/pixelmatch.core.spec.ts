import { PNG } from 'pngjs';
import { DEFAULT_BLUR_AMPLITUDE_THRESHOLD, DEFAULT_BLUR_SIGMA } from './blur-amplitude.core';
import { computePixelmatchDiff, PixelmatchJobInput } from './pixelmatch.core';
import { computeChangeSignature } from './signature.core';
import { THUMBNAIL_MAX_DIMENSION } from './thumbnail.core';

const WIDTH = 60;
const HEIGHT = 60;

const png = (paint: (set: (x: number, y: number, rgb: [number, number, number]) => void) => void): Buffer => {
  const image = new PNG({ width: WIDTH, height: HEIGHT });
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    image.data[i * 4] = 255;
    image.data[i * 4 + 1] = 255;
    image.data[i * 4 + 2] = 255;
    image.data[i * 4 + 3] = 255;
  }
  paint((x, y, [r, g, b]) => {
    const index = (y * WIDTH + x) * 4;
    image.data[index] = r;
    image.data[index + 1] = g;
    image.data[index + 2] = b;
  });
  return PNG.sync.write(image);
};

const block = (left: number, top: number, rgb: [number, number, number]): Buffer =>
  png((set) => {
    for (let y = top; y < top + 12; y++) {
      for (let x = left; x < left + 12; x++) {
        set(x, y, rgb);
      }
    }
  });

const blank = png(() => undefined);
const RED: [number, number, number] = [255, 0, 0];

const diffJob = (
  baseline: Buffer,
  image: Buffer,
  withSignature: boolean,
  withThumbnails = false,
  {
    saveDiff = true,
    diffTolerancePercent = 0,
    includeAA = false,
    blurAmplitude = undefined as PixelmatchJobInput['blurAmplitude'],
  } = {}
) =>
  computePixelmatchDiff({
    kind: 'diff',
    baseline,
    image,
    ignoreAreas: [],
    threshold: 0.1,
    includeAA,
    allowDiffDimensions: false,
    diffTolerancePercent,
    saveDiff,
    withSignature,
    withThumbnails,
    blurAmplitude,
  });

describe('computePixelmatchDiff with a signature', () => {
  // The whole point of computing it here is to reuse the decode the diff
  // already paid for. If the fused version answered differently from the
  // standalone one, stored signatures would stop matching computed ones and
  // variations would silently stop grouping.
  it('gives the same signature the standalone job would', () => {
    const image = block(10, 10, RED);

    const fused = diffJob(blank, image, true).signature;
    const standalone = computeChangeSignature({
      kind: 'signature',
      baseline: blank,
      image,
      ignoreAreas: [],
      threshold: 0.1,
      includeAA: false,
    }).signature;

    expect(fused).toEqual(standalone);
    expect(fused).not.toBeNull();
  });

  it('leaves the signature out when it was not asked for', () => {
    expect(diffJob(blank, block(10, 10, RED), false).signature).toBeUndefined();
  });

  it('has no signature when the screenshots are identical', () => {
    expect(diffJob(blank, blank, true).signature).toBeUndefined();
  });

  it('still reports the diff it was asked for', () => {
    const result = diffJob(blank, block(10, 10, RED), true);

    expect(result.equal).toBe(false);
    expect(result.pixelMisMatchCount).toBe(144);
  });
});

describe('computePixelmatchDiff with thumbnails', () => {
  // Made here from the pixels the diff has already decoded and already drawn,
  // so a thumbnail costs a resize rather than a second read of the screenshot.
  it('returns a small picture of both the checkpoint and the diff', () => {
    const result = diffJob(blank, block(10, 10, RED), false, true);

    const image = PNG.sync.read(Buffer.from(result.imageThumbnail!));
    const diff = PNG.sync.read(Buffer.from(result.diffThumbnail!));
    expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(THUMBNAIL_MAX_DIMENSION);
    expect(Math.max(diff.width, diff.height)).toBeLessThanOrEqual(THUMBNAIL_MAX_DIMENSION);
  });

  it('makes none when they were not asked for', () => {
    const result = diffJob(blank, block(10, 10, RED), false, false);

    expect(result.imageThumbnail).toBeUndefined();
    expect(result.diffThumbnail).toBeUndefined();
  });

  // A build is mostly runs that pass. Resizing two images for each of those,
  // when the diff they belong to is thrown away seconds later, is work nobody
  // ever sees the result of.
  it('makes none when the change is under tolerance', () => {
    const result = diffJob(blank, block(10, 10, RED), false, true, { diffTolerancePercent: 90 });

    expect(result.imageThumbnail).toBeUndefined();
    expect(result.diffThumbnail).toBeUndefined();
  });

  it('makes none when the caller is not keeping the diff', () => {
    const result = diffJob(blank, block(10, 10, RED), false, true, { saveDiff: false });

    expect(result.imageThumbnail).toBeUndefined();
  });

  // nothing to show and nothing to shrink
  it('makes none when the screenshots are identical', () => {
    expect(diffJob(blank, blank, false, true).imageThumbnail).toBeUndefined();
  });
});

describe('computePixelmatchDiff with the blur-amplitude filter', () => {
  const BLACK: [number, number, number] = [0, 0, 0];
  const hairline = (column: number): Buffer =>
    png((set) => {
      for (let y = 0; y < HEIGHT; y++) {
        set(column, y, BLACK);
      }
    });
  const filter = { sigma: DEFAULT_BLUR_SIGMA, threshold: DEFAULT_BLUR_AMPLITUDE_THRESHOLD };
  // AA counted, as the project default `ignoreAntialiasing: true` actually
  // configures pixelmatch: the moved hairline is then a real mismatch for it
  const withFilter = (baseline: Buffer, image: Buffer, options: Parameters<typeof diffJob>[4] = {}) =>
    diffJob(baseline, image, false, true, { includeAA: true, blurAmplitude: filter, ...options });

  // an edge rasterised one pixel further over: pixelmatch sees two columns of
  // changed pixels, a person sees the same line
  it('marks a change no stronger than rendering noise', () => {
    const result = withFilter(hairline(10), hairline(11));

    expect(result.pixelMisMatchCount).toBeGreaterThan(0);
    expect(result.blurAmplitude).toBeLessThan(DEFAULT_BLUR_AMPLITUDE_THRESHOLD);
    expect(result.renderingNoiseOnly).toBe(true);
  });

  // the run is about to pass, so a diff and thumbnails for it would be thrown
  // away unseen
  it('produces no diff for a change it passes', () => {
    const result = withFilter(hairline(10), hairline(11));

    expect(result.diffBuffer).toBeUndefined();
    expect(result.imageThumbnail).toBeUndefined();
    expect(result.diffThumbnail).toBeUndefined();
  });

  it('lets a real change through with its diff', () => {
    const result = withFilter(blank, block(10, 10, RED));

    expect(result.blurAmplitude).toBeGreaterThan(DEFAULT_BLUR_AMPLITUDE_THRESHOLD);
    expect(result.renderingNoiseOnly).toBe(false);
    expect(result.diffBuffer).toBeDefined();
    expect(result.imageThumbnail).toBeDefined();
  });

  // faint, so under the threshold, but a whole panel of it: not noise
  it('lets a faint but solid change through', () => {
    const panel = png((set) => {
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          set(x, y, [224, 224, 224]);
        }
      }
    });

    const result = withFilter(blank, panel);

    expect(result.blurAmplitude).toBeLessThan(DEFAULT_BLUR_AMPLITUDE_THRESHOLD);
    expect(result.renderingNoiseOnly).toBe(false);
  });

  // as CompareService does for the other comparators: a size change is a
  // finding of its own, whatever the padded pixels look like
  it('does not judge screenshots of different sizes', () => {
    const taller = (() => {
      const image = new PNG({ width: WIDTH, height: HEIGHT + 5 });
      image.data.fill(255);
      return PNG.sync.write(image);
    })();

    const result = computePixelmatchDiff({
      kind: 'diff',
      baseline: blank,
      image: taller,
      ignoreAreas: [],
      threshold: 0.1,
      includeAA: true,
      allowDiffDimensions: true,
      diffTolerancePercent: 0,
      saveDiff: true,
      blurAmplitude: filter,
    });

    expect(result.isSameDimension).toBe(false);
    expect(result.renderingNoiseOnly).toBeUndefined();
    expect(result.blurAmplitude).toBeUndefined();
  });

  it('measures nothing when the filter is off', () => {
    const result = diffJob(hairline(10), hairline(11), false, false, { includeAA: true });

    expect(result.blurAmplitude).toBeUndefined();
    expect(result.renderingNoiseOnly).toBeUndefined();
    expect(result.diffBuffer).toBeDefined();
  });

  // a run under tolerance passes anyway; blurring it would be work for nothing
  it('measures nothing when the change is under tolerance', () => {
    const result = withFilter(hairline(10), hairline(11), { diffTolerancePercent: 90 });

    expect(result.blurAmplitude).toBeUndefined();
    expect(result.renderingNoiseOnly).toBeUndefined();
  });
});
