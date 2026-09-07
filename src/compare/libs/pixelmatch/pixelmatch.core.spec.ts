import { PNG } from 'pngjs';
import { computePixelmatchDiff } from './pixelmatch.core';
import { computeChangeSignature } from './signature.core';

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

const diffJob = (baseline: Buffer, image: Buffer, withSignature: boolean) =>
  computePixelmatchDiff({
    kind: 'diff',
    baseline,
    image,
    ignoreAreas: [],
    threshold: 0.1,
    includeAA: false,
    allowDiffDimensions: false,
    diffTolerancePercent: 0,
    saveDiff: false,
    withSignature,
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
