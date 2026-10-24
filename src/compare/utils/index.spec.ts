import { PNG } from 'pngjs';
import { IgnoreAreaDto } from '../../test-runs/dto/ignore-area.dto';
import { generatePng } from '../../_data_';
import { Logger } from '@nestjs/common';
import { applyIgnoreAreas, downscale, parseConfig, scaleImageToSize } from '.';

describe('utils', () => {
  it.each<[PNG, IgnoreAreaDto[]]>([
    [generatePng(3, 3), []],
    [generatePng(3, 3), [{ x: 0, y: 0, width: 3, height: 3 }]],
    [generatePng(3, 3), [{ x: -3, y: -3, width: 3, height: 3 }]],
    [generatePng(3, 3), [{ x: 1, y: 1, width: 5, height: 5 }]],
  ])('applyIgnoreAreas', (image, ignoreAreas) => {
    expect(applyIgnoreAreas(image, ignoreAreas).data).toMatchSnapshot();
  });
});

describe('parseConfig', () => {
  const defaults = { threshold: 0.1, ignoreAntialiasing: true };
  const logger = { error: jest.fn() } as unknown as Logger;

  it.each<[string, string, object]>([
    [
      'a full config as given',
      '{"threshold":0.5,"ignoreAntialiasing":false}',
      { threshold: 0.5, ignoreAntialiasing: false },
    ],
    ['a partial config over the defaults', '{"threshold":0.5}', { threshold: 0.5, ignoreAntialiasing: true }],
    ['options the defaults do not name', '{"allowDiffDimensions":true}', { ...defaults, allowDiffDimensions: true }],
    ['the defaults for null', 'null', defaults],
    ['the defaults for an empty string', '', defaults],
    ['the defaults for invalid JSON', 'invalid', defaults],
    ['the defaults for a JSON value that is not an object', '5', defaults],
    ['the defaults for a JSON array', '[1]', defaults],
  ])('returns %s', (_, json, expected) => {
    expect(parseConfig(json, defaults, logger)).toStrictEqual(expected);
  });
});

// pixel i of a w x h image gets channels [i, 100 + i, 200 - i, 50 + i] so every channel is distinguishable
const distinctPixels = (width: number, height: number): Buffer => {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = i;
    data[i * 4 + 1] = 100 + i;
    data[i * 4 + 2] = 200 - i;
    data[i * 4 + 3] = 50 + i;
  }
  return data;
};

const pixelOf = (data: Buffer, index: number): number[] => [...data.subarray(index * 4, index * 4 + 4)];

describe('applyIgnoreAreas edges', () => {
  it('clears all four channels inside the area and leaves the first row and column after it untouched', () => {
    const image = generatePng(3, 3);

    applyIgnoreAreas(image, [{ x: 0, y: 0, width: 2, height: 1 }]);

    expect(pixelOf(image.data, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelOf(image.data, 1)).toEqual([0, 0, 0, 0]);
    // column right after the area
    expect(pixelOf(image.data, 2)).toEqual([255, 255, 255, 255]);
    // row right after the area
    expect(pixelOf(image.data, 3)).toEqual([255, 255, 255, 255]);
    expect(pixelOf(image.data, 4)).toEqual([255, 255, 255, 255]);
  });

  it('clears an area in the middle of the image without touching its surroundings', () => {
    const image = generatePng(4, 4);

    applyIgnoreAreas(image, [{ x: 1, y: 1, width: 2, height: 2 }]);

    const cleared = [5, 6, 9, 10];
    for (let i = 0; i < 16; i++) {
      expect(pixelOf(image.data, i)).toEqual(cleared.includes(i) ? [0, 0, 0, 0] : [255, 255, 255, 255]);
    }
  });
});

describe('scaleImageToSize', () => {
  it('returns the same image when the requested size equals the image size', () => {
    const image = generatePng(3, 2);

    expect(scaleImageToSize(image, 3, 2)).toBe(image);
  });

  it('returns the same image when only the height is requested smaller', () => {
    const image = generatePng(3, 3);

    expect(scaleImageToSize(image, 3, 2)).toBe(image);
  });

  it('pads a wider canvas with transparent black, keeping the original pixels top-left', () => {
    const image = new PNG({ width: 2, height: 1 });
    distinctPixels(2, 1).copy(image.data);

    const result = scaleImageToSize(image, 3, 1);

    expect(result).not.toBe(image);
    expect(result.width).toBe(3);
    expect(result.height).toBe(1);
    expect([...result.data]).toEqual([0, 100, 200, 50, 1, 101, 199, 51, 0, 0, 0, 0]);
  });

  it('pads a taller canvas with transparent black, keeping the original pixels top-left', () => {
    const image = new PNG({ width: 1, height: 1 });
    distinctPixels(1, 1).copy(image.data);

    const result = scaleImageToSize(image, 1, 2);

    expect(result.width).toBe(1);
    expect(result.height).toBe(2);
    expect([...result.data]).toEqual([0, 100, 200, 50, 0, 0, 0, 0]);
  });
});

describe('downscale', () => {
  it('returns the source itself when it already fits', () => {
    const source = { data: distinctPixels(2, 2), width: 2, height: 2 };

    expect(downscale(source, 2)).toBe(source);
  });

  it('picks the nearest-neighbour source pixel for every target pixel', () => {
    const source = { data: distinctPixels(4, 4), width: 4, height: 4 };

    const result = downscale(source, 2);

    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(result.data.length).toBe(2 * 2 * 4);
    // target (x, y) <- source (2x, 2y): source indexes 0, 2, 8, 10
    expect([...result.data]).toEqual([
      ...pixelOf(source.data, 0),
      ...pixelOf(source.data, 2),
      ...pixelOf(source.data, 8),
      ...pixelOf(source.data, 10),
    ]);
  });

  it('scales by the longest side and keeps the aspect ratio', () => {
    const source = { data: distinctPixels(6, 3), width: 6, height: 3 };

    const result = downscale(source, 2);

    expect(result.width).toBe(2);
    expect(result.height).toBe(1);
    // target x 0 <- source x 0, target x 1 <- source x 3 (scale 1/3)
    expect([...result.data]).toEqual([...pixelOf(source.data, 0), ...pixelOf(source.data, 3)]);
  });
});
