import { PNG } from 'pngjs';
import { computeChangeSignature } from './signature.core';

const WIDTH = 40;
const HEIGHT = 40;

const png = (paint: (set: (x: number, y: number, rgb: [number, number, number]) => void) => void): Buffer => {
  const image = new PNG({ width: WIDTH, height: HEIGHT });
  image.data.fill(255);
  paint((x, y, [r, g, b]) => {
    const index = (y * WIDTH + x) * 4;
    image.data[index] = r;
    image.data[index + 1] = g;
    image.data[index + 2] = b;
    image.data[index + 3] = 255;
  });
  return PNG.sync.write(image);
};

const block = (left: number, top: number, rgb: [number, number, number]): Buffer =>
  png((set) => {
    for (let y = top; y < top + 8; y++) {
      for (let x = left; x < left + 8; x++) {
        set(x, y, rgb);
      }
    }
  });

const blank = png(() => undefined);

const RED: [number, number, number] = [255, 0, 0];
const BLUE: [number, number, number] = [0, 0, 255];

const signatureOf = (baseline: Buffer, image: Buffer, ignoreAreas = []): number[] | null =>
  computeChangeSignature({
    kind: 'signature',
    baseline,
    image,
    ignoreAreas,
    threshold: 0.1,
    includeAA: false,
  }).signature;

describe('computeChangeSignature', () => {
  it('has no signature when the images have different dimensions', () => {
    const taller = new PNG({ width: WIDTH, height: HEIGHT * 2 });
    taller.data.fill(255);

    expect(signatureOf(blank, PNG.sync.write(taller))).toBeNull();
  });

  it('has no signature when nothing changed', () => {
    expect(signatureOf(blank, blank)).toBeNull();
  });

  it('concentrates on the color the changed pixels took in the new image', () => {
    const signature = signatureOf(blank, block(0, 0, RED));

    const brightest = signature.indexOf(Math.max(...signature));
    // 4 buckets per channel: pure red is the last red bucket, first green/blue
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
