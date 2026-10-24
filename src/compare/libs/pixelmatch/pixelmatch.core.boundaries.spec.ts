import { PNG } from 'pngjs';
import { computePixelmatchDiff, PixelmatchJobInput } from './pixelmatch.core';

// white image with the first `redPixels` pixels (row by row) painted red
const png = (width: number, height: number, redPixels = 0): Buffer => {
  const image = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    image.data[i * 4] = 255;
    image.data[i * 4 + 1] = i < redPixels ? 0 : 255;
    image.data[i * 4 + 2] = i < redPixels ? 0 : 255;
    image.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(image);
};

const job = (baseline: Buffer, image: Buffer, overrides: Partial<PixelmatchJobInput> = {}) =>
  computePixelmatchDiff({
    kind: 'diff',
    baseline,
    image,
    ignoreAreas: [],
    threshold: 0.1,
    // count every differing pixel, so the percentages below are exact
    includeAA: true,
    allowDiffDimensions: false,
    diffTolerancePercent: 0,
    saveDiff: true,
    ...overrides,
  });

describe('computePixelmatchDiff tolerance boundary', () => {
  // 36 of 3600 pixels differ: exactly 1%
  const baseline = png(60, 60);
  const image = png(60, 60, 36);

  it('reports the mismatch count and percent', () => {
    const result = job(baseline, image, { diffTolerancePercent: 1 });

    expect(result.equal).toBe(false);
    expect(result.isSameDimension).toBe(true);
    expect(result.pixelMisMatchCount).toBe(36);
    expect(result.diffPercent).toBe(1);
  });

  it('does not keep the diff when the percent equals the tolerance', () => {
    const result = job(baseline, image, { diffTolerancePercent: 1, withThumbnails: true });

    expect(result.diffBuffer).toBeUndefined();
    expect(result.imageThumbnail).toBeUndefined();
    expect(result.diffThumbnail).toBeUndefined();
  });

  it('keeps the diff and thumbnails when the percent is just over the tolerance', () => {
    const result = job(baseline, image, { diffTolerancePercent: 0.99, withThumbnails: true });

    expect(PNG.sync.read(Buffer.from(result.diffBuffer!)).width).toBe(60);
    expect(result.imageThumbnail).toBeDefined();
    expect(result.diffThumbnail).toBeDefined();
  });

  it('does not keep the diff over the tolerance when saving is off', () => {
    const result = job(baseline, image, { diffTolerancePercent: 0, saveDiff: false, withThumbnails: true });

    expect(result.diffBuffer).toBeUndefined();
    expect(result.imageThumbnail).toBeUndefined();
  });
});

describe('computePixelmatchDiff dimensions', () => {
  it('stops at a different height when different dimensions are not allowed', () => {
    expect(job(png(60, 60), png(60, 30, 1))).toStrictEqual({ equal: false, isSameDimension: false });
  });

  it('stops at a different width when different dimensions are not allowed', () => {
    expect(job(png(60, 60), png(30, 60, 1))).toStrictEqual({ equal: false, isSameDimension: false });
  });

  it('compares on the larger canvas when different dimensions are allowed', () => {
    // the checkpoint is padded with transparent pixels, which pixelmatch blends to white:
    // only the baseline's red first row differs
    const result = job(png(10, 10, 10), png(10, 5), { allowDiffDimensions: true, withSignature: true });

    expect(result.equal).toBe(false);
    expect(result.isSameDimension).toBe(false);
    expect(result.pixelMisMatchCount).toBe(10);
    expect(result.diffPercent).toBe(10);
    expect(PNG.sync.read(Buffer.from(result.diffBuffer!)).height).toBe(10);
    // no signature for screenshots of different sizes
    expect(result.signature).toBeUndefined();
  });
});
