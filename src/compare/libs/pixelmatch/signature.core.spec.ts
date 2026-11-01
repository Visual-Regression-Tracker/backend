import { paintedPng, pngBytes, Rgb, solidPng, square } from '../../test-utils';
import {
  computeChangeSignature,
  signaturesMatch,
  SIGNATURE_LENGTH,
  SIGNATURE_SIMILARITY_THRESHOLD,
} from './signature.core';
import { IgnoreAreaDto } from '../../../test-runs/dto/ignore-area.dto';

const WIDTH = 40;
const HEIGHT = 40;

const block = (left: number, top: number, rgb: Rgb): Buffer =>
  pngBytes(paintedPng(WIDTH, HEIGHT, square(left, top, 8, rgb)));

const blank = pngBytes(solidPng(WIDTH, HEIGHT));

const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];

const signatureOf = (baseline: Buffer, image: Buffer, ignoreAreas: IgnoreAreaDto[] = []): number[] | null =>
  computeChangeSignature({
    kind: 'signature',
    baseline,
    image,
    ignoreAreas,
    threshold: 0.1,
    includeAA: false,
  }).signature;

describe('computeChangeSignature', () => {
  it.each([
    ['different dimensions', WIDTH, HEIGHT * 2],
    ['the same pixel count but another shape', WIDTH * 2, HEIGHT / 2],
    ['another width only', WIDTH * 2, HEIGHT],
  ])('has no signature for a checkpoint with %s', (_, width, height) => {
    expect(signatureOf(blank, pngBytes(solidPng(width, height)))).toBeNull();
  });

  it('has no signature when nothing changed', () => {
    expect(signatureOf(blank, blank)).toBeNull();
  });

  it('has no signature when the checkpoint cannot be decoded', () => {
    expect(signatureOf(blank, Buffer.from('not a png'))).toBeNull();
  });

  it('has no signature when the baseline is truncated', () => {
    expect(signatureOf(blank.subarray(0, 30), block(0, 0, RED))).toBeNull();
  });

  it('concentrates on the color the changed pixels took in the new image', () => {
    const signature = signatureOf(blank, block(0, 0, RED))!;

    const brightest = signature.indexOf(Math.max(...signature));
    expect(brightest).toBe(3 * 16);
    expect(signature.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });

  it('is the same wherever the change sits, so per-locale reflow still matches', () => {
    expect(signatureOf(blank, block(0, 0, RED))).toEqual(signatureOf(blank, block(24, 28, RED)));
  });

  it('tells a different color of change apart', () => {
    expect(signatureOf(blank, block(0, 0, RED))).not.toEqual(signatureOf(blank, block(0, 0, BLUE)));
  });

  it('has no signature when the only change is inside an ignore area', () => {
    const ignoreAreas = [{ x: 0, y: 0, width: 16, height: 16 }];

    expect(signatureOf(blank, block(4, 4, RED), ignoreAreas)).toBeNull();
  });
});

describe('computeChangeSignature with structured-clone input', () => {
  it('reads Uint8Array views the same as Buffers', () => {
    const changed = block(0, 0, RED);
    const padded = new Uint8Array(changed.length + 16);
    padded.set(changed, 16);
    const view = new Uint8Array(padded.buffer, 16, changed.length);
    const baselineView = new Uint8Array(blank);

    expect(
      computeChangeSignature({
        kind: 'signature',
        baseline: baselineView,
        image: view,
        ignoreAreas: [],
        threshold: 0.1,
        includeAA: false,
      }).signature
    ).toEqual(signatureOf(blank, changed));
  });
});

describe('signaturesMatch', () => {
  it('matches a signature with itself', () => {
    const signature = signatureOf(blank, block(0, 0, RED))!;

    expect(signaturesMatch(signature, signature)).toBe(true);
  });

  it('matches the same change in another place', () => {
    expect(signaturesMatch(signatureOf(blank, block(0, 0, RED))!, signatureOf(blank, block(24, 28, RED))!)).toBe(true);
  });

  it('does not match a change of another color', () => {
    expect(signaturesMatch(signatureOf(blank, block(0, 0, RED))!, signatureOf(blank, block(0, 0, BLUE))!)).toBe(false);
  });

  it('matches at a cosine similarity of at least 0.9', () => {
    expect(SIGNATURE_SIMILARITY_THRESHOLD).toBe(0.9);
    expect(signaturesMatch([1, 0], [0.95, 0.3])).toBe(true);
    expect(signaturesMatch([1, 0], [0.8, 0.6])).toBe(false);
  });

  it('does not match when either signature is all zeros', () => {
    expect(signaturesMatch([0, 0], [1, 0])).toBe(false);
    expect(signaturesMatch([1, 0], [0, 0])).toBe(false);
  });

  it('compares only the buckets of the first signature (signatures are always SIGNATURE_LENGTH long)', () => {
    expect(SIGNATURE_LENGTH).toBe(64);
    expect(signaturesMatch([1, 0], [1])).toBe(false);
    expect(signaturesMatch([1], [1, 5])).toBe(true);
  });
});
