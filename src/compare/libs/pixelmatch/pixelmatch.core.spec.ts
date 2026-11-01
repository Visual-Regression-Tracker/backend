import Pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { DEFAULT_BLUR_AMPLITUDE_THRESHOLD } from './blur-amplitude.core';
import { readSameSizePair } from '../../utils';
import { DINOV2_PATCH, gateOfDecoded } from './patch-gate.core';
import { computePixelmatchDiff, PixelmatchJobInput } from './pixelmatch.core';
import { computeChangeSignature } from './signature.core';
import { THUMBNAIL_MAX_DIMENSION } from './thumbnail.core';
import { paintedPng, pngBytes, Rgb, solidPng, square } from '../../test-utils';

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
    blurAmplitude = undefined as PixelmatchJobInput['blurAmplitude'],
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
    blurAmplitude,
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

describe('computePixelmatchDiff with the blur-amplitude filter', () => {
  const hairline = (column: number): Buffer => png((x) => (x === column ? [0, 0, 0] : undefined));
  const filter = { threshold: DEFAULT_BLUR_AMPLITUDE_THRESHOLD };
  const withFilter = (baseline: Buffer, image: Buffer, options: Parameters<typeof diffJob>[2] = {}) =>
    diffJob(baseline, image, { includeAA: true, blurAmplitude: filter, ...options });

  it('marks a change no stronger than rendering noise, and produces no diff for it', () => {
    const result = withFilter(hairline(10), hairline(11));

    expect(result.pixelMisMatchCount).toBeGreaterThan(0);
    expect(result.blurAmplitude).toBeLessThan(DEFAULT_BLUR_AMPLITUDE_THRESHOLD);
    expect(result.renderingNoiseOnly).toBe(true);
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

  it('lets a faint but solid change through', () => {
    const result = withFilter(blank, pngBytes(solidPng(WIDTH, HEIGHT, [224, 224, 224])));

    expect(result.blurAmplitude).toBeLessThan(DEFAULT_BLUR_AMPLITUDE_THRESHOLD);
    expect(result.renderingNoiseOnly).toBe(false);
  });

  it('does not judge screenshots of different sizes', () => {
    const taller = pngBytes(solidPng(WIDTH, HEIGHT + 5));

    const result = withFilter(blank, taller, { allowDiffDimensions: true });

    expect(result.isSameDimension).toBe(false);
    expect(result.renderingNoiseOnly).toBeUndefined();
    expect(result.blurAmplitude).toBeUndefined();
  });

  it('keeps the diff of a noise-like change when a DINOv2 check will follow', () => {
    const result = withFilter(hairline(10), hairline(11), {
      blurAmplitude: { ...filter, dinov2: { threshold: 0.15 } },
    });

    expect(result.renderingNoiseOnly).toBe(true);
    expect(result.diffBuffer).toBeDefined();
    expect(result.imageThumbnail).toBeDefined();
  });

  describe('with the DINOv2 check', () => {
    const checked = { ...filter, dinov2: { threshold: 0.15 } };
    const gated = (baseline: Buffer, image: Buffer, options: Parameters<typeof diffJob>[2] = {}) =>
      withFilter(baseline, image, { blurAmplitude: checked, ...options });
    const gateOf = (baseline: Buffer, image: Buffer, ignoreAreas: PixelmatchJobInput['ignoreAreas']) => {
      const pair = readSameSizePair(baseline, image, ignoreAreas)!;
      return gateOfDecoded(pair.baseline, pair.image, DINOV2_PATCH);
    };

    it('computes the DINOv2 patch gate of a noise-like change', () => {
      const ignoreAreas = [{ x: 40, y: 40, width: 5, height: 5 }];
      const result = gated(hairline(10), hairline(11), { ignoreAreas });

      expect(result.renderingNoiseOnly).toBe(true);
      expect(result.gate).toEqual(gateOf(hairline(10), hairline(11), ignoreAreas));
      expect(result.gate?.cells.length).toBeGreaterThan(0);
    });

    it('leaves out what the ignore areas cover', () => {
      const ignoreAreas = [{ x: 0, y: 0, width: 30, height: 28 }];
      const result = gated(hairline(10), hairline(11), { ignoreAreas });

      expect(result.gate?.cells.length).toBeGreaterThan(0);
      expect(result.gate?.cells.every((cell) => Math.floor(cell / 5) >= 2)).toBe(true);
      expect(result.gate).toEqual(gateOf(hairline(10), hairline(11), ignoreAreas));
    });

    it('computes no gate for a change that is not noise', () => {
      const result = gated(blank, block(10, 10, RED));

      expect(result.renderingNoiseOnly).toBe(false);
      expect(result.gate).toBeUndefined();
    });

    it('computes no gate when the check is off', () => {
      const result = withFilter(hairline(10), hairline(11), { blurAmplitude: filter });

      expect(result.renderingNoiseOnly).toBe(true);
      expect(result.gate).toBeUndefined();
    });
  });

  it('measures nothing and computes no gate when the filter is off', () => {
    const result = diffJob(hairline(10), hairline(11), { includeAA: true });

    expect(result.gate).toBeUndefined();
    expect(result.blurAmplitude).toBeUndefined();
    expect(result.renderingNoiseOnly).toBeUndefined();
    expect(result.diffBuffer).toBeDefined();
  });

  it('measures nothing when the change is under tolerance', () => {
    const result = withFilter(hairline(10), hairline(11), { diffTolerancePercent: 90 });

    expect(result.blurAmplitude).toBeUndefined();
    expect(result.renderingNoiseOnly).toBeUndefined();
  });
});
