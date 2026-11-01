import { readFileSync } from 'fs';
import { join } from 'path';
import { PNG } from 'pngjs';
import { DiffWorkerPool } from './diff-worker-pool';
import { ImageTooLargeException } from '../static/utils';
import { PixelmatchJobInput } from './libs/pixelmatch/pixelmatch.core';
import { SignatureJobInput } from './libs/pixelmatch/signature.core';
import { pngBytes, solidPng } from './test-utils';

const png = (width: number, height: number, level: number): Buffer =>
  pngBytes(solidPng(width, height, [level, level, level]));

const diffJob = (baseline: Buffer, image: Buffer, allowDiffDimensions = false): PixelmatchJobInput => ({
  kind: 'diff',
  baseline,
  image,
  ignoreAreas: [],
  threshold: 0.1,
  includeAA: false,
  allowDiffDimensions,
  diffTolerancePercent: 0,
  saveDiff: false,
});

const signatureJob = (baseline: Buffer, image: Buffer): SignatureJobInput => ({
  kind: 'signature',
  baseline,
  image,
  ignoreAreas: [],
  threshold: 0.1,
  includeAA: false,
});

describe('DiffWorkerPool', () => {
  let pool: DiffWorkerPool;

  beforeEach(() => {
    pool = new DiffWorkerPool();
  });

  afterEach(async () => {
    await pool.onApplicationShutdown();
  });

  it('answers a diff job with the pixel mismatch it found', async () => {
    const output = await pool.run(diffJob(png(10, 10, 0), png(10, 10, 255)));

    expect(output).toMatchObject({ equal: false, pixelMisMatchCount: 100 });
  });

  it('answers a signature job with a change signature', async () => {
    const output = await pool.run(signatureJob(png(10, 10, 0), png(10, 10, 255)));

    expect(output.signature).toHaveLength(64);
    expect(output.signature!.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });

  it('answers a looks-same job', async () => {
    const fixture = (name: string) => readFileSync(join(__dirname, '../../test', name));

    const output = await pool.run({
      kind: 'looks-same',
      baseline: fixture('image.png'),
      image: fixture('image_edited.png'),
      ignoreAreas: [],
      config: { strict: false, ignoreAntialiasing: true, ignoreCaret: true },
      saveDiff: false,
    });

    expect(output).toMatchObject({ outcome: 'compared', result: { equal: false, differentPixels: 31068 } });
  });

  describe('MAX_IMAGE_PIXELS', () => {
    const originalLimit = process.env.MAX_IMAGE_PIXELS;

    beforeEach(() => {
      process.env.MAX_IMAGE_PIXELS = '50';
    });

    afterEach(() => {
      if (originalLimit === undefined) {
        delete process.env.MAX_IMAGE_PIXELS;
      } else {
        process.env.MAX_IMAGE_PIXELS = originalLimit;
      }
      jest.restoreAllMocks();
    });

    it('rejects a job whose image is above MAX_IMAGE_PIXELS with 422, before decoding', async () => {
      const read = jest.spyOn(PNG.sync, 'read');

      const rejection = pool.run(diffJob(png(10, 10, 0), png(5, 5, 0)));

      await expect(rejection).rejects.toBeInstanceOf(ImageTooLargeException);
      await expect(rejection).rejects.toMatchObject({ status: 422 });
      expect(read).not.toHaveBeenCalled();
    });

    it('checks the baseline as well as the new image', async () => {
      await expect(pool.run(diffJob(png(5, 5, 0), png(10, 10, 0)))).rejects.toBeInstanceOf(ImageTooLargeException);
    });

    it('checks every job kind', async () => {
      await expect(pool.run(signatureJob(png(10, 10, 0), png(10, 10, 255)))).rejects.toBeInstanceOf(
        ImageTooLargeException
      );
    });

    it('rejects a diff whose canvas would exceed the limit when other sizes are allowed', async () => {
      process.env.MAX_IMAGE_PIXELS = '60';
      const wide = png(10, 5, 0);
      const tall = png(5, 10, 0);

      await expect(pool.run(diffJob(wide, tall, true))).rejects.toBeInstanceOf(ImageTooLargeException);
      await expect(pool.run(diffJob(wide, tall, false))).resolves.toMatchObject({
        equal: false,
        isSameDimension: false,
      });
    });

    it('leaves a malformed header to the decoder', async () => {
      const rejection = pool.run(diffJob(Buffer.from('png'), png(5, 5, 0)));

      await expect(rejection).rejects.toThrow();
      await expect(rejection).rejects.not.toBeInstanceOf(ImageTooLargeException);
    });
  });
});
