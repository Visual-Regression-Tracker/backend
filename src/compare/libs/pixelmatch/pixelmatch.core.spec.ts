import Pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { computePixelmatchDiff, PixelmatchJobInput } from './pixelmatch.core';
import { computeChangeSignature } from './signature.core';
import { THUMBNAIL_MAX_DIMENSION } from './thumbnail.core';
import { paintedPng, pngBytes, Rgb, square } from '../../test-utils';

const WIDTH = 60;
const HEIGHT = 60;

const png = (paint?: (x: number, y: number) => Rgb | undefined): Buffer => pngBytes(paintedPng(WIDTH, HEIGHT, paint));

const block = (left: number, top: number, rgb: Rgb): Buffer => png(square(left, top, 12, rgb));

const blank = png();
const RED: Rgb = [255, 0, 0];

const diffJob = (
  baseline: Buffer,
  image: Buffer,
  {
    saveDiff = true,
    diffTolerancePercent = 0,
    includeAA = false,
    allowDiffDimensions = false,
    ignoreAreas = [] as PixelmatchJobInput['ignoreAreas'],
  } = {}
) =>
  computePixelmatchDiff({
    kind: 'diff',
    baseline,
    image,
    ignoreAreas,
    threshold: 0.1,
    includeAA,
    allowDiffDimensions,
    diffTolerancePercent,
    saveDiff,
  });

describe('computePixelmatchDiff with a signature', () => {
  afterEach(() => jest.restoreAllMocks());

  it('gives the same signature the standalone job would', () => {
    const image = block(10, 10, RED);

    const fused = diffJob(blank, image).signature;
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

  it('leaves the signature out when the diff is not kept', () => {
    expect(diffJob(blank, block(10, 10, RED), { saveDiff: false }).signature).toBeUndefined();
  });

  it('has no signature when the screenshots are identical', () => {
    expect(diffJob(blank, blank).signature).toBeUndefined();
  });

  it('still reports the diff it was asked for', () => {
    const result = diffJob(blank, block(10, 10, RED));

    expect(result.equal).toBe(false);
    expect(result.pixelMisMatchCount).toBe(144);
  });

  it('encodes the diff with the Sub filter without changing a pixel of it', () => {
    const image = block(10, 10, RED);
    const write = jest.spyOn(PNG.sync, 'write');
    const expected = new PNG({ width: WIDTH, height: HEIGHT });
    Pixelmatch(PNG.sync.read(blank).data, PNG.sync.read(image).data, expected.data, WIDTH, HEIGHT, {
      includeAA: false,
      threshold: 0.1,
    });

    const result = diffJob(blank, image);
    const decoded = PNG.sync.read(Buffer.from(result.diffBuffer!));

    expect(write).toHaveBeenCalledWith(expect.any(PNG), expect.objectContaining({ filterType: 1 }));
    expect([decoded.width, decoded.height]).toStrictEqual([WIDTH, HEIGHT]);
    expect(decoded.data.equals(expected.data)).toBe(true);
  });
});

describe('computePixelmatchDiff with thumbnails', () => {
  it('returns a small picture of both the checkpoint and the diff', () => {
    const result = diffJob(blank, block(10, 10, RED));

    const image = PNG.sync.read(Buffer.from(result.imageThumbnail!));
    const diff = PNG.sync.read(Buffer.from(result.diffThumbnail!));
    expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(THUMBNAIL_MAX_DIMENSION);
    expect(Math.max(diff.width, diff.height)).toBeLessThanOrEqual(THUMBNAIL_MAX_DIMENSION);
  });

  it('makes none when the change is under tolerance', () => {
    const result = diffJob(blank, block(10, 10, RED), { diffTolerancePercent: 90 });

    expect(result.imageThumbnail).toBeUndefined();
    expect(result.diffThumbnail).toBeUndefined();
  });

  it('makes none when the caller is not keeping the diff', () => {
    const result = diffJob(blank, block(10, 10, RED), { saveDiff: false });

    expect(result.imageThumbnail).toBeUndefined();
  });

  it('makes none when the screenshots are identical', () => {
    expect(diffJob(blank, blank).imageThumbnail).toBeUndefined();
  });
});
