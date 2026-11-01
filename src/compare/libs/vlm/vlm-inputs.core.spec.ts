import { PNG } from 'pngjs';
import { pngBytes, solidPng } from '../../test-utils';
import { computeVlmInputs } from './vlm-inputs.core';

const redPng = (width = 4, height = 4, gamma?: number): Buffer => {
  const png = solidPng(width, height, [255, 0, 0]);
  if (gamma !== undefined) {
    png.gamma = gamma;
  }
  return pngBytes(png);
};

const pixelAt = (png: PNG, x: number, y: number) =>
  Array.from(png.data.subarray(4 * (png.width * y + x), 4 * (png.width * y + x) + 4));

describe('computeVlmInputs', () => {
  afterEach(() => jest.restoreAllMocks());

  it('masks the ignore areas of both pictures', () => {
    const output = computeVlmInputs({
      kind: 'vlm-inputs',
      baseline: redPng(),
      image: redPng(),
      ignoreAreas: [{ x: 1, y: 1, width: 2, height: 2 }],
    });

    for (const bytes of [output.baseline, output.image]) {
      const png = PNG.sync.read(Buffer.from(bytes!));
      expect([png.width, png.height]).toEqual([4, 4]);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const ignored = x >= 1 && x < 3 && y >= 1 && y < 3;
          expect(pixelAt(png, x, y)).toEqual(ignored ? [0, 0, 0, 0] : [255, 0, 0, 255]);
        }
      }
    }
  });

  it('keeps the gamma of the source', () => {
    const output = computeVlmInputs({
      kind: 'vlm-inputs',
      baseline: redPng(4, 4, 0.45455),
      image: redPng(),
      ignoreAreas: [],
    });

    expect(PNG.sync.read(Buffer.from(output.baseline!)).gamma).toBe(0.45455);
  });

  it('encodes with the Sub filter', () => {
    const [baseline, image] = [redPng(), redPng()];
    const write = jest.spyOn(PNG.sync, 'write');

    computeVlmInputs({ kind: 'vlm-inputs', baseline, image, ignoreAreas: [] });

    expect(write).toHaveBeenCalledTimes(2);
    for (const [, options] of write.mock.calls) {
      expect(options).toEqual(expect.objectContaining({ filterType: 1 }));
    }
  });

  it('returns null for a picture that does not decode', () => {
    const output = computeVlmInputs({
      kind: 'vlm-inputs',
      baseline: Buffer.from('not a png'),
      image: redPng(),
      ignoreAreas: [],
    });

    expect(output.baseline).toBeNull();
    expect(output.image).toBeInstanceOf(Uint8Array);
  });

  it('accepts the Uint8Array views a worker receives', () => {
    const source = redPng();
    const view = new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));

    const output = computeVlmInputs({ kind: 'vlm-inputs', baseline: view, image: view, ignoreAreas: [] });

    expect(PNG.sync.read(Buffer.from(output.image!)).width).toBe(4);
  });

  it('returns a structured-clone serializable result', () => {
    const output = computeVlmInputs({
      kind: 'vlm-inputs',
      baseline: redPng(),
      image: Buffer.from('not a png'),
      ignoreAreas: [],
    });

    expect(() => structuredClone(output)).not.toThrow();
    expect(structuredClone(output).image).toBeNull();
  });
});
