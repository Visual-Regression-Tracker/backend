import { PNG } from 'pngjs';
import { RawImage } from '../../utils';
import {
  BlurAmplitudeJobInput,
  BlurredDifference,
  computeBlurAmplitude,
  DEFAULT_BLUR_AMPLITUDE_THRESHOLD,
  isRenderingNoise,
  MAX_MEASURED_PIXELS,
  MAX_SOLID_SHARE,
  measureBlurredDifference,
} from './blur-amplitude.core';
import { DINOV2_PATCH, gateOfDecoded } from './patch-gate.core';
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
    expect(amplitude).toBeLessThan(DEFAULT_BLUR_AMPLITUDE_THRESHOLD);
  });

  it('keeps a hairline moved by one pixel under the default threshold', () => {
    const amplitude = maxBlurredDifference(column(10), column(11));

    expect(amplitude).toBeCloseTo(47.935, 2);
    expect(amplitude).toBeLessThan(DEFAULT_BLUR_AMPLITUDE_THRESHOLD);
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
      DEFAULT_BLUR_AMPLITUDE_THRESHOLD
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

describe('isRenderingNoise', () => {
  it('is noise when the change is weak and thin', () => {
    expect(isRenderingNoise({ amplitude: 40, solidPixels: 0, solidShare: 0 }, 80)).toBe(true);
  });

  it('is not noise when the change is too strong', () => {
    expect(isRenderingNoise({ amplitude: 81, solidPixels: 0, solidShare: 0 }, 80)).toBe(false);
  });

  it('is not noise when too much of the change is solid, however faint', () => {
    expect(isRenderingNoise({ amplitude: 31, solidPixels: 1, solidShare: MAX_SOLID_SHARE + 0.001 }, 80)).toBe(false);
  });

  it('is not noise when nothing could be measured', () => {
    expect(isRenderingNoise(null, 80)).toBe(false);
  });

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

    const measure = measured(flat(255), flat(224));

    expect(measure.amplitude).toBeLessThan(DEFAULT_BLUR_AMPLITUDE_THRESHOLD);
    expect(isRenderingNoise(measure, DEFAULT_BLUR_AMPLITUDE_THRESHOLD)).toBe(false);
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

  describe('with the gate asked for', () => {
    const dot = pixel(10, 10);
    const gated = (overrides: Partial<BlurAmplitudeJobInput> = {}) =>
      job({ image: encode(dot), gateIfNoise: { threshold: DEFAULT_BLUR_AMPLITUDE_THRESHOLD }, ...overrides });

    it('returns the DINOv2 patch gate of a pair it takes for rendering noise', () => {
      const output = computeBlurAmplitude(gated());

      expect(isRenderingNoise(output.measure, DEFAULT_BLUR_AMPLITUDE_THRESHOLD)).toBe(true);
      expect(output.gate).toEqual(gateOfDecoded(blank, dot, DINOV2_PATCH));
      expect(output.gate?.cells).toEqual([0]);
    });

    it('leaves out what the ignore areas cover', () => {
      const output = computeBlurAmplitude(gated({ ignoreAreas: [{ x: 8, y: 8, width: 4, height: 4 }] }));

      expect(output.gate?.cells).toEqual([]);
    });

    it('returns no gate for a change stronger than rendering noise', () => {
      const output = computeBlurAmplitude(gated({ image: encode(block) }));

      expect(output.measure?.amplitude).toBeGreaterThan(DEFAULT_BLUR_AMPLITUDE_THRESHOLD);
      expect(output.gate).toBeUndefined();
    });

    it('judges the noise by the threshold it is given', () => {
      expect(computeBlurAmplitude(gated({ gateIfNoise: { threshold: 30 } })).gate).toBeUndefined();
    });

    it('returns no gate when it was not asked for', () => {
      expect(computeBlurAmplitude(job({ image: encode(dot) })).gate).toBeUndefined();
    });

    it('returns no gate for screenshots it cannot line up', () => {
      expect(computeBlurAmplitude(gated({ image: Buffer.from('not a png') }))).toEqual({ measure: null });
    });

    it('returns a gate that survives a structured clone', () => {
      const output = computeBlurAmplitude(gated());

      expect(structuredClone(output)).toEqual(output);
    });
  });

  it('is what the worker runs for a blur-amplitude job', () => {
    expect(runWorkerJob(job())).toEqual(computeBlurAmplitude(job()));
  });
});
