import { PNG } from 'pngjs';
import { paintedPng, pngBytes } from '../../test-utils';
import { computePixelmatchDiff, PixelmatchJobInput } from './pixelmatch.core';

const png = (width: number, height: number, redPixels = 0): Buffer =>
  pngBytes(paintedPng(width, height, (x, y) => (y * width + x < redPixels ? [255, 0, 0] : undefined)));

const job = (baseline: Buffer, image: Buffer, overrides: Partial<PixelmatchJobInput> = {}) =>
  computePixelmatchDiff({
    kind: 'diff',
    baseline,
    image,
    ignoreAreas: [],
    threshold: 0.1,
    includeAA: true,
    allowDiffDimensions: false,
    diffTolerancePercent: 0,
    saveDiff: true,
    ...overrides,
  });

describe('computePixelmatchDiff tolerance boundary', () => {
  const baseline = png(60, 60);
  const image = png(60, 60, 36);

  it('reports the mismatch count and percent, and does not keep the diff when the percent equals the tolerance', () => {
    const result = job(baseline, image, { diffTolerancePercent: 1 });

    expect(result.equal).toBe(false);
    expect(result.isSameDimension).toBe(true);
    expect(result.pixelMisMatchCount).toBe(36);
    expect(result.diffPercent).toBe(1);
    expect(result.diffBuffer).toBeUndefined();
    expect(result.imageThumbnail).toBeUndefined();
    expect(result.diffThumbnail).toBeUndefined();
  });

  it('keeps the diff and thumbnails when the percent is just over the tolerance', () => {
    const result = job(baseline, image, { diffTolerancePercent: 0.99 });

    expect(PNG.sync.read(Buffer.from(result.diffBuffer!)).width).toBe(60);
    expect(result.imageThumbnail).toBeDefined();
    expect(result.diffThumbnail).toBeDefined();
  });

  it('does not keep the diff over the tolerance when saving is off', () => {
    const result = job(baseline, image, { diffTolerancePercent: 0, saveDiff: false });

    expect(result.diffBuffer).toBeUndefined();
    expect(result.imageThumbnail).toBeUndefined();
  });
});

describe('computePixelmatchDiff dimensions', () => {
  it.each([
    ['height', png(60, 30, 1)],
    ['width', png(30, 60, 1)],
  ])('stops at a different %s when different dimensions are not allowed', (_, image) => {
    expect(job(png(60, 60), image)).toStrictEqual({ equal: false, isSameDimension: false });
  });

  const wide = png(60, 30, 60);
  const tall = png(30, 60, 60);

  it('stops at another shape with the same pixel bytes when different dimensions are not allowed', () => {
    expect(job(wide, tall)).toStrictEqual({ equal: false, isSameDimension: false });
  });

  it('compares another shape with the same pixel bytes instead of calling it equal when dimensions may differ', () => {
    const result = job(wide, tall, { allowDiffDimensions: true });

    expect(result.equal).toBe(false);
    expect(result.isSameDimension).toBe(false);
    expect(result.pixelMisMatchCount).toBeGreaterThan(0);
  });

  it('compares on the larger canvas when different dimensions are allowed', () => {
    const result = job(png(10, 10, 10), png(10, 5), { allowDiffDimensions: true });

    expect(result.equal).toBe(false);
    expect(result.isSameDimension).toBe(false);
    expect(result.pixelMisMatchCount).toBe(10);
    expect(result.diffPercent).toBe(10);
    expect(PNG.sync.read(Buffer.from(result.diffBuffer!)).height).toBe(10);
    expect(result.signature).toBeUndefined();
  });
});
