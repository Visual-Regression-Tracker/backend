import { PNG } from 'pngjs';
import { RawImage } from '../../utils';
import {
  BlurAmplitudeJobInput,
  BlurredDifference,
  computeBlurAmplitude,
  analyseDifference,
  DENSITY_WINDOW,
  MAX_MEASURED_PIXELS,
  measureBlurredDifference,
} from './blur-amplitude.core';
import { DEFAULT_NOISE_ANALYSIS_CONFIG } from '../../noise-hint/noise-analysis.config';
import { DINOV2_PATCH, gateOfDecoded } from './patch-gate.core';
import { runWorkerJob } from './worker-job';

const { amplitudeThreshold: BLUR_AMPLITUDE_THRESHOLD, solidShareMax: MAX_SOLID_SHARE } =
  DEFAULT_NOISE_ANALYSIS_CONFIG.blur;
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
const pixel = (px: number, py: number, rgba: Rgba = BLACK) =>
  image((x, y) => (x === px && y === py ? rgba : undefined));
const column = (col: number) => image((x) => (x === col ? BLACK : undefined));
const box = (rgba: Rgba = BLACK) => image((x, y) => (x >= 4 && x < 16 && y >= 4 && y < 16 ? rgba : undefined));

const measured = (a: RawImage, b: RawImage): BlurredDifference => {
  const measure = measureBlurredDifference(a, b);
  if (!measure) {
    throw new Error('expected a measure');
  }
  return measure;
};

const maxBlurredDifference = (a: RawImage, b: RawImage): number => measured(a, b).amplitude;

// expected: scipy.ndimage.gaussian_filter(sigma=1, truncate=4, mode='reflect')
describe('measureBlurredDifference', () => {
  it('is zero for identical images', () => {
    expect(maxBlurredDifference(blank, image())).toBe(0);
  });

  it('keeps an isolated pixel well under the default threshold', () => {
    const amplitude = maxBlurredDifference(blank, pixel(10, 10));

    expect(amplitude).toBeCloseTo(40.585, 2);
    expect(amplitude).toBeLessThan(BLUR_AMPLITUDE_THRESHOLD);
  });

  it('keeps a hairline moved by one pixel under the default threshold', () => {
    const amplitude = maxBlurredDifference(column(10), column(11));

    expect(amplitude).toBeCloseTo(47.935, 2);
    expect(amplitude).toBeLessThan(BLUR_AMPLITUDE_THRESHOLD);
  });

  it('reports the full contrast of a solid element that appeared', () => {
    expect(maxBlurredDifference(blank, box())).toBeCloseTo(255, 2);
  });

  it('mirrors the image at its border', () => {
    expect(maxBlurredDifference(blank, pixel(0, 0))).toBeCloseTo(104.747, 2);
  });

  it('reads transparent pixels as white', () => {
    expect(maxBlurredDifference(blank, pixel(10, 10, [0, 0, 0, 0]))).toBe(0);
  });

  it('sees a change of hue at equal brightness', () => {
    expect(maxBlurredDifference(box([255, 0, 0, 255]), box([76, 76, 76, 255]))).toBeGreaterThan(
      BLUR_AMPLITUDE_THRESHOLD
    );
  });

  it('refuses images of different sizes', () => {
    const smaller: RawImage = { data: Buffer.alloc(4 * 4 * 4), width: 4, height: 4 };

    expect(() => maxBlurredDifference(blank, smaller)).toThrow();
  });

  it('counts the pixels of a solid change, not those of an edge', () => {
    expect(measured(blank, box([200, 200, 200, 255])).solidPixels).toBeGreaterThan(50);
    expect(measured(blank, column(10)).solidPixels).toBe(0);
  });

  it('gives no measure for a changed area beyond the size limit', () => {
    const width = 4000;
    const height = Math.ceil(MAX_MEASURED_PIXELS / width) + 1;
    const a: RawImage = { data: Buffer.alloc(width * height * 4, 255), width, height };
    const b: RawImage = { data: Buffer.from(a.data), width, height };
    b.data[0] = 0;
    b.data[b.data.length - 4] = 0;

    expect(measureBlurredDifference(a, b)).toBeNull();
  });
});

describe('a faint panel shade', () => {
  it('is solid enough to count as a change', () => {
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

    const measure = measured(flat(255), flat(224));

    expect(measure.amplitude).toBeLessThan(BLUR_AMPLITUDE_THRESHOLD);
    expect(measure.solidShare).toBeGreaterThan(MAX_SOLID_SHARE);
  });
});

describe('computeBlurAmplitude', () => {
  const encode = (raw: RawImage): Buffer => {
    const png = new PNG({ width: raw.width, height: raw.height });
    raw.data.copy(png.data);
    return PNG.sync.write(png);
  };
  const block = box();
  const job = (overrides: Partial<BlurAmplitudeJobInput> = {}): BlurAmplitudeJobInput => ({
    kind: 'blur-amplitude',
    baseline: encode(blank),
    image: encode(block),
    ignoreAreas: [],
    thresholds: DEFAULT_NOISE_ANALYSIS_CONFIG.blur,
    ...overrides,
  });

  it('measures the change between two screenshots', () => {
    expect(computeBlurAmplitude(job()).measure?.amplitude).toBeCloseTo(255, 2);
  });

  it('leaves out what the ignore areas cover', () => {
    expect(computeBlurAmplitude(job({ ignoreAreas: [{ x: 0, y: 0, width: SIZE, height: SIZE }] })).measure).toEqual({
      amplitude: 0,
      solidPixels: 0,
      solidShare: 0,
    });
  });

  it('has no answer for screenshots of different sizes', () => {
    const smaller = encode({ data: Buffer.alloc(4 * 4 * 4, 255), width: 4, height: 4 });

    expect(computeBlurAmplitude(job({ image: smaller })).measure).toBeNull();
  });

  it('has no answer for bytes that are not a PNG', () => {
    expect(computeBlurAmplitude(job({ image: Buffer.from('not a png') })).measure).toBeNull();
  });

  it('reads the Uint8Array views a worker message turns Buffers into', () => {
    const viaMessage = job({ baseline: new Uint8Array(encode(blank)), image: new Uint8Array(encode(block)) });

    expect(computeBlurAmplitude(viaMessage).measure?.amplitude).toBeCloseTo(255, 2);
  });

  describe('the DINOv2 patch gate', () => {
    const dot = pixel(10, 10);
    const noise = (overrides: Partial<BlurAmplitudeJobInput> = {}) => job({ image: encode(dot), ...overrides });

    it('comes with a pair taken for rendering noise', () => {
      const output = computeBlurAmplitude(noise());

      expect(output.gate).toEqual(gateOfDecoded(blank, dot, DINOV2_PATCH));
      expect(output.gate?.cells).toEqual([0]);
    });

    it('leaves out what the ignore areas cover', () => {
      const output = computeBlurAmplitude(noise({ ignoreAreas: [{ x: 8, y: 8, width: 4, height: 4 }] }));

      expect(output.gate?.cells).toEqual([]);
    });

    it('is absent for a change stronger than rendering noise', () => {
      const output = computeBlurAmplitude(job());

      expect(output.measure?.amplitude).toBeGreaterThan(BLUR_AMPLITUDE_THRESHOLD);
      expect(output.gate).toBeUndefined();
    });

    it('is absent for screenshots it cannot line up', () => {
      expect(computeBlurAmplitude(noise({ image: Buffer.from('not a png') }))).toEqual({
        measure: null,
        density: 0,
        densest: [],
      });
    });

    it('follows the thresholds of the job', () => {
      const strict = { amplitudeThreshold: 10, solidShareMax: 0 };
      const loose = { amplitudeThreshold: 300, solidShareMax: 1 };

      expect(computeBlurAmplitude(noise({ thresholds: strict })).gate).toBeUndefined();
      expect(computeBlurAmplitude(job({ thresholds: loose })).gate).toBeDefined();
    });

    it('survives a structured clone', () => {
      const output = computeBlurAmplitude(noise());

      expect(structuredClone(output)).toEqual(output);
    });
  });

  it('is what the worker runs for a blur-amplitude job', () => {
    expect(runWorkerJob(job())).toEqual(computeBlurAmplitude(job()));
  });

  describe('the density of the change', () => {
    const CANVAS = 48;
    const canvas = (paint: (x: number, y: number) => boolean): RawImage => {
      const data = Buffer.alloc(CANVAS * CANVAS * 4, 255);
      for (let y = 0; y < CANVAS; y++) {
        for (let x = 0; x < CANVAS; x++) {
          if (paint(x, y)) data.fill(0, (y * CANVAS + x) * 4, (y * CANVAS + x) * 4 + 3);
        }
      }
      return { data, width: CANVAS, height: CANVAS };
    };
    const emptyCanvas = canvas(() => false);
    const run = (changed: RawImage, overrides: Partial<BlurAmplitudeJobInput> = {}) =>
      computeBlurAmplitude(job({ baseline: encode(emptyCanvas), image: encode(changed), ...overrides }));

    it('puts a digit-like blob into one dense window', () => {
      const output = run(canvas((x, y) => x >= 9 && x <= 13 && y >= 8 && y <= 14));

      expect(output.density).toBeGreaterThanOrEqual((DENSITY_WINDOW * DENSITY_WINDOW) / 2);
      expect(output.densest).toEqual([{ x: 8, y: 8, width: 8, height: 8, weight: 35 }]);
    });

    it('keeps sparse dots below a few pixels per window', () => {
      const output = run(canvas((x, y) => x % 4 === 2 && y % 8 === 3));

      expect(output.density).toBeLessThanOrEqual(3);
      expect(output.densest.every(({ weight }) => weight <= 3)).toBe(true);
    });

    it('lists at most five windows, the densest first', () => {
      const output = run(canvas((x, y) => y < 8 && x < 8 * 7 && x % 8 < 1 + (Math.floor(x / 8) % 7)));

      expect(output.densest).toHaveLength(5);
      const weights = output.densest.map(({ weight }) => weight);
      expect(weights).toEqual([...weights].sort((a, b) => b - a));
      expect(output.density).toBe(weights[0]);
    });

    it('breaks ties by position', () => {
      const output = run(canvas((x, y) => (x === 30 && y === 30) || (x === 2 && y === 20) || (x === 20 && y === 2)));

      expect(output.densest.map(({ x, y }) => [x, y])).toEqual([
        [16, 0],
        [0, 16],
        [24, 24],
      ]);
    });

    it('counts a block that straddles a window border in the windows it touches', () => {
      const output = run(canvas((x, y) => x >= 6 && x < 10 && y >= 0 && y < 2));

      expect(output.densest.map(({ x, weight }) => [x, weight])).toEqual([
        [0, 4],
        [8, 4],
      ]);
    });

    it('leaves out what the ignore areas cover', () => {
      const output = run(
        canvas((x, y) => x >= 9 && x <= 13 && y >= 8 && y <= 14),
        { ignoreAreas: [{ x: 0, y: 0, width: CANVAS, height: CANVAS }] }
      );

      expect(output).toMatchObject({ density: 0, densest: [] });
    });

    it('is zero for identical screenshots', () => {
      expect(run(emptyCanvas)).toMatchObject({ density: 0, densest: [] });
    });

    it('is not measured beyond the size limit', () => {
      const width = 4000;
      const height = Math.ceil(MAX_MEASURED_PIXELS / width) + 1;
      const a: RawImage = { data: Buffer.alloc(width * height * 4, 255), width, height };
      const b: RawImage = { data: Buffer.from(a.data), width, height };
      b.data[0] = 0;
      b.data[b.data.length - 4] = 0;

      expect(analyseDifference(a, b, DEFAULT_NOISE_ANALYSIS_CONFIG.blur)).toEqual({
        measure: null,
        density: 0,
        densest: [],
      });
    });

    it('survives a structured clone', () => {
      const output = run(canvas((x, y) => x >= 9 && x <= 13 && y >= 8 && y <= 14));

      expect(structuredClone(output)).toEqual(output);
    });
  });
});
