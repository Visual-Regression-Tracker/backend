import { PNG } from 'pngjs';
import { RawImage } from '../../utils';
import {
  BlurAmplitudeJobInput,
  computeBlurAmplitude,
  DEFAULT_BLUR_AMPLITUDE_THRESHOLD,
  isRenderingNoise,
  MAX_MEASURED_PIXELS,
  MAX_SOLID_SHARE,
  measureBlurredDifference,
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

const maxBlurredDifference = (a: RawImage, b: RawImage, sigma: number): number =>
  measureBlurredDifference(a, b, sigma).amplitude;

// Expected values are scipy.ndimage.gaussian_filter (sigma=1, truncate=4,
// mode='reflect') on the same black-and-white images, where every channel and
// the luma agree.
describe('measureBlurredDifference', () => {
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

  // anti-aliasing lives on edges, which the blur flattens; a filled shape's
  // inside it leaves as it was
  it('counts the pixels of a solid change, not those of an edge', () => {
    const block = image((x, y) => (x >= 4 && x < 16 && y >= 4 && y < 16 ? [200, 200, 200, 255] : undefined));
    const hairline = image((x) => (x === 10 ? BLACK : undefined));

    expect(measureBlurredDifference(blank, block, 1).solidPixels).toBeGreaterThan(50);
    expect(measureBlurredDifference(blank, hairline, 1).solidPixels).toBe(0);
  });

  // measuring a change spread over a huge screenshot would cost seconds and
  // hundreds of megabytes in a worker
  it('gives no measure for a changed area beyond the size limit', () => {
    const width = 4000;
    const height = Math.ceil(MAX_MEASURED_PIXELS / width) + 1;
    const a: RawImage = { data: Buffer.alloc(width * height * 4, 255), width, height };
    const b: RawImage = { data: Buffer.from(a.data), width, height };
    b.data[0] = 0;
    b.data[b.data.length - 4] = 0;

    expect(measureBlurredDifference(a, b, 1)).toBeNull();
  });
});

describe('isRenderingNoise', () => {
  it('is noise when the change is weak and thin', () => {
    expect(isRenderingNoise({ amplitude: 40, solidPixels: 0, solidShare: 0 }, 80)).toBe(true);
  });

  it('is not noise when the change is too strong', () => {
    expect(isRenderingNoise({ amplitude: 81, solidPixels: 0, solidShare: 0 }, 80)).toBe(false);
  });

  // a panel turned light grey: faint, so under any threshold, but solid
  it('is not noise when too much of the change is solid, however faint', () => {
    expect(isRenderingNoise({ amplitude: 31, solidPixels: 1, solidShare: MAX_SOLID_SHARE + 0.001 }, 80)).toBe(false);
  });

  it('is not noise when nothing could be measured', () => {
    expect(isRenderingNoise(null, 80)).toBe(false);
  });

  // measured on a real-size picture rather than on numbers
  it('sees a faint panel shade as a change', () => {
    const size = 200;
    const flat = (shade: number): RawImage => {
      const data = Buffer.alloc(size * size * 4, 255);
      for (let y = 20; y < 180; y++) {
        for (let x = 20; x < 180; x++) {
          data.fill(shade, (y * size + x) * 4, (y * size + x) * 4 + 3);
        }
      }
      return { data, width: size, height: size };
    };

    const measure = measureBlurredDifference(flat(255), flat(224), 1);

    expect(measure.amplitude).toBeLessThan(DEFAULT_BLUR_AMPLITUDE_THRESHOLD);
    expect(isRenderingNoise(measure, DEFAULT_BLUR_AMPLITUDE_THRESHOLD)).toBe(false);
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
    expect(computeBlurAmplitude(job()).measure.amplitude).toBeCloseTo(255, 2);
  });

  // what the project has masked out must not decide its verdict
  it('leaves out what the ignore areas cover', () => {
    expect(computeBlurAmplitude(job({ ignoreAreas: [{ x: 0, y: 0, width: SIZE, height: SIZE }] })).measure).toEqual({
      amplitude: 0,
      solidPixels: 0,
      solidShare: 0,
    });
  });

  // a comparator allowed to compare different sizes has nothing to line up
  it('has no answer for screenshots of different sizes', () => {
    const smaller = encode({ data: Buffer.alloc(4 * 4 * 4, 255), width: 4, height: 4 });

    expect(computeBlurAmplitude(job({ image: smaller })).measure).toBeNull();
  });

  // the caller keeps the comparator's verdict rather than failing the upload
  it('has no answer for bytes that are not a PNG', () => {
    expect(computeBlurAmplitude(job({ image: Buffer.from('not a png') })).measure).toBeNull();
  });

  // what a Buffer arrives as on the far side of postMessage
  it('reads the Uint8Array views a worker message turns Buffers into', () => {
    const viaMessage = job({ baseline: new Uint8Array(encode(blank)), image: new Uint8Array(encode(block)) });

    expect(computeBlurAmplitude(viaMessage).measure.amplitude).toBeCloseTo(255, 2);
  });

  it('is what the worker runs for a blur-amplitude job', () => {
    expect(runWorkerJob(job())).toEqual(computeBlurAmplitude(job()));
  });
});
