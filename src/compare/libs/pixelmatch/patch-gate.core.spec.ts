import { PNG } from 'pngjs';
import { computePatchGate, PatchGateJobInput } from './patch-gate.core';
import { runWorkerJob } from './worker-job';

const WIDTH = 60;
const HEIGHT = 40;

const png = (paint: (x: number, y: number) => [number, number, number] | undefined = () => undefined): Buffer => {
  const image = new PNG({ width: WIDTH, height: HEIGHT });
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const [r, g, b] = paint(x, y) ?? [255, 255, 255];
      image.data.set([r, g, b, 255], (y * WIDTH + x) * 4);
    }
  }
  return PNG.sync.write(image);
};

const blank = png();
// a solid block covering patch (1, 2) only: rows 14-27, columns 28-41
const block = png((x, y) => (x >= 30 && x < 40 && y >= 16 && y < 26 ? [200, 40, 40] : undefined));

const job = (overrides: Partial<PatchGateJobInput> = {}): PatchGateJobInput => ({
  kind: 'patch-gate',
  baseline: blank,
  image: block,
  ignoreAreas: [],
  patch: 14,
  ...overrides,
});

describe('computePatchGate', () => {
  it('marks the patches where pixelmatch sees a change', () => {
    expect(computePatchGate(job()).gate).toEqual({ width: 5, height: 3, cells: [1 * 5 + 2] });
  });

  it('marks nothing for identical screenshots', () => {
    expect(computePatchGate(job({ image: blank })).gate).toEqual({ width: 5, height: 3, cells: [] });
  });

  // what the project has masked out must not decide the verdict
  it('leaves out what the ignore areas cover', () => {
    expect(computePatchGate(job({ ignoreAreas: [{ x: 28, y: 14, width: 14, height: 14 }] })).gate?.cells).toEqual([]);
  });

  it('has no answer for screenshots of different sizes', () => {
    const taller = new PNG({ width: WIDTH, height: HEIGHT + 4 });
    taller.data.fill(255);

    expect(computePatchGate(job({ image: PNG.sync.write(taller) })).gate).toBeNull();
  });

  it('has no answer for bytes that are not a PNG', () => {
    expect(computePatchGate(job({ image: Buffer.from('not a png') })).gate).toBeNull();
  });

  // what a Buffer arrives as on the far side of postMessage
  it('reads the Uint8Array views a worker message turns Buffers into', () => {
    expect(
      computePatchGate(job({ baseline: new Uint8Array(blank), image: new Uint8Array(block) })).gate?.cells
    ).toEqual([7]);
  });

  it('is what the worker runs for a patch-gate job', () => {
    expect(runWorkerJob(job())).toEqual(computePatchGate(job()));
  });
});
