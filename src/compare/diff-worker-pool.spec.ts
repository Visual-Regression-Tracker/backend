import { PNG } from 'pngjs';
import { DiffWorkerPool } from './diff-worker-pool';

// Opaque throughout: pixelmatch composites transparent pixels onto white, so a
// fully transparent image would read as equal to a white one.
const png = (width: number, height: number, rgb: number): Buffer => {
  const image = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    image.data[i * 4] = rgb;
    image.data[i * 4 + 1] = rgb;
    image.data[i * 4 + 2] = rgb;
    image.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(image);
};

describe('DiffWorkerPool', () => {
  let pool: DiffWorkerPool;

  beforeEach(() => {
    pool = new DiffWorkerPool();
  });

  afterEach(async () => {
    await pool.onModuleDestroy();
  });

  it('answers a diff job with the pixel mismatch it found', async () => {
    const output = await pool.run({
      kind: 'diff',
      baseline: png(10, 10, 0),
      image: png(10, 10, 255),
      ignoreAreas: [],
      threshold: 0.1,
      includeAA: false,
      allowDiffDimensions: false,
      diffTolerancePercent: 0,
      saveDiff: false,
    });

    expect(output).toMatchObject({ equal: false, pixelMisMatchCount: 100 });
  });

  it('answers a signature job with a change signature', async () => {
    const output = await pool.run({
      kind: 'signature',
      baseline: png(10, 10, 0),
      image: png(10, 10, 255),
      ignoreAreas: [],
      threshold: 0.1,
      includeAA: false,
    });

    expect(output.signature).toHaveLength(64);
    expect(output.signature.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });
});
