import { PNG } from 'pngjs';
import { RawImage } from '../../utils';
import {
  BlurAmplitudeJobInput,
  computeBlurAmplitude,
  DEFAULT_BLUR_AMPLITUDE_THRESHOLD,
  maxBlurredDifference,
} from './blur-amplitude.core';
import { runWorkerJob } from './worker-job';

const SIZE = 20;
type Rgba = [number, number, number, number];
const WHITE: Rgba = [255, 255, 255, 255];
const BLACK: Rgba = [0, 0, 0, 255];

const image = (paint: (x: number, y: number) => Rgba | undefined = () => undefined): RawImage => {
  const data = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      data.set(paint(x, y) ?? WHITE, (y * SIZE + x) * 4);
    }
  }
  return { data, width: SIZE, height: SIZE };
};

const blank = image();

// Expected values are scipy.ndimage.gaussian_filter (sigma=1, truncate=4,
// mode='reflect') on the same black-and-white images, where every channel and
// the luma agree.
describe('maxBlurredDifference', () => {
  it('is zero for identical images', () => {
    expect(maxBlurredDifference(blank, image(), 1)).toBe(0);
  });

  // what anti-aliasing mostly is: single pixels flipping along edges
  it('keeps an isolated pixel well under the default threshold', () => {
    const amplitude = maxBlurredDifference(
      blank,
      image((x, y) => (x === 10 && y === 10 ? BLACK : undefined)),
      1
    );

    expect(amplitude).toBeCloseTo(40.585, 2);
    expect(amplitude).toBeLessThan(DEFAULT_BLUR_AMPLITUDE_THRESHOLD);
  });

  // the other thing it is: an edge landing one pixel further over
  it('keeps a hairline moved by one pixel under the default threshold', () => {
    const before = image((x) => (x === 10 ? BLACK : undefined));
    const after = image((x) => (x === 11 ? BLACK : undefined));

    const amplitude = maxBlurredDifference(before, after, 1);

    expect(amplitude).toBeCloseTo(47.935, 2);
    expect(amplitude).toBeLessThan(DEFAULT_BLUR_AMPLITUDE_THRESHOLD);
  });

  it('reports the full contrast of a solid element that appeared', () => {
    const block = image((x, y) => (x >= 4 && x < 16 && y >= 4 && y < 16 ? BLACK : undefined));

    expect(maxBlurredDifference(blank, block, 1)).toBeCloseTo(255, 2);
  });

  // the image is mirrored at its border, not padded with nothing, so a change
  // in a corner is not underrated
  it('mirrors the image at its border', () => {
    const corner = image((x, y) => (x === 0 && y === 0 ? BLACK : undefined));

    expect(maxBlurredDifference(blank, corner, 1)).toBeCloseTo(104.747, 2);
  });

  it('spreads a change thinner under a wider blur', () => {
    const dot = image((x, y) => (x === 10 && y === 10 ? BLACK : undefined));

    expect(maxBlurredDifference(blank, dot, 2)).toBeCloseTo(10.146, 2);
  });

  // ignore areas are blanked to transparent black, and pixelmatch reads
  // transparent pixels as white; reading them the same way keeps a masked area
  // from looking like a change against a white background
  it('reads transparent pixels as white', () => {
    const transparent = image((x, y) => (x === 10 && y === 10 ? [0, 0, 0, 0] : undefined));

    expect(maxBlurredDifference(blank, transparent, 1)).toBe(0);
  });

  // luma alone would call this nothing: the grey has the red's brightness
  it('sees a change of hue at equal brightness', () => {
    const red = image((x, y) => (x >= 4 && x < 16 && y >= 4 && y < 16 ? [255, 0, 0, 255] : undefined));
    const grey = image((x, y) => (x >= 4 && x < 16 && y >= 4 && y < 16 ? [76, 76, 76, 255] : undefined));

    expect(maxBlurredDifference(red, grey, 1)).toBeGreaterThan(DEFAULT_BLUR_AMPLITUDE_THRESHOLD);
  });

  it('refuses images of different sizes', () => {
    const smaller: RawImage = { data: Buffer.alloc(4 * 4 * 4), width: 4, height: 4 };

    expect(() => maxBlurredDifference(blank, smaller, 1)).toThrow();
  });
});

describe('computeBlurAmplitude', () => {
  // the worker-pool job: PNG bytes in, so the decoding happens off the event loop
  const encode = (raw: RawImage): Buffer => {
    const png = new PNG({ width: raw.width, height: raw.height });
    raw.data.copy(png.data);
    return PNG.sync.write(png);
  };
  const block = image((x, y) => (x >= 4 && x < 16 && y >= 4 && y < 16 ? BLACK : undefined));
  const job = (overrides: Partial<BlurAmplitudeJobInput> = {}): BlurAmplitudeJobInput => ({
    kind: 'blur-amplitude',
    baseline: encode(blank),
    image: encode(block),
    ignoreAreas: [],
    sigma: 1,
    ...overrides,
  });

  it('measures the change between two screenshots', () => {
    expect(computeBlurAmplitude(job()).amplitude).toBeCloseTo(255, 2);
  });

  // what the project has masked out must not decide its verdict
  it('leaves out what the ignore areas cover', () => {
    expect(computeBlurAmplitude(job({ ignoreAreas: [{ x: 0, y: 0, width: SIZE, height: SIZE }] })).amplitude).toBe(0);
  });

  // a comparator allowed to compare different sizes has nothing to line up
  it('has no answer for screenshots of different sizes', () => {
    const smaller = encode({ data: Buffer.alloc(4 * 4 * 4, 255), width: 4, height: 4 });

    expect(computeBlurAmplitude(job({ image: smaller })).amplitude).toBeNull();
  });

  // the caller keeps the comparator's verdict rather than failing the upload
  it('has no answer for bytes that are not a PNG', () => {
    expect(computeBlurAmplitude(job({ image: Buffer.from('not a png') })).amplitude).toBeNull();
  });

  // what a Buffer arrives as on the far side of postMessage
  it('reads the Uint8Array views a worker message turns Buffers into', () => {
    const viaMessage = job({ baseline: new Uint8Array(encode(blank)), image: new Uint8Array(encode(block)) });

    expect(computeBlurAmplitude(viaMessage).amplitude).toBeCloseTo(255, 2);
  });

  it('is what the worker runs for a blur-amplitude job', () => {
    expect(runWorkerJob(job())).toEqual(computeBlurAmplitude(job()));
  });
});
