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
    expect(pixelOf(image.data, 2)).toEqual([255, 255, 255, 255]);
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

const masked = (image: PNG): number[] => {
  const indexes: number[] = [];
  for (let i = 0; i < image.width * image.height; i++) {
    if (image.data[i * 4 + 3] === 0) {
      indexes.push(i);
    }
  }
  return indexes;
};

const legacyApply = (image: PNG, ignoreAreas: IgnoreAreaDto[]): PNG => {
  ignoreAreas.forEach((area) => {
    for (let y = area.y; y < Math.min(area.y + area.height, image.height); y++) {
      for (let x = area.x; x < Math.min(area.x + area.width, image.width); x++) {
        const k = 4 * (image.width * y + x);
        image.data[k + 0] = 0;
        image.data[k + 1] = 0;
        image.data[k + 2] = 0;
        image.data[k + 3] = 0;
      }
    }
  });
  return image;
};

describe('applyIgnoreAreas rounding and clamping', () => {
  it('masks every pixel a fractional area touches', () => {
    const image = generatePng(4, 4);

    applyIgnoreAreas(image, [{ x: 0.5, y: 0.5, width: 1, height: 1 }]);

    expect(masked(image)).toEqual([0, 1, 4, 5]);
    for (const index of masked(image)) {
      expect(pixelOf(image.data, index)).toEqual([0, 0, 0, 0]);
    }
  });

  it.each([
    ['does not wrap a negative x into the previous row', 4, { x: -2, y: 1, width: 3, height: 1 }, [4]],
    ['clips a negative y to the first row', 4, { x: 1, y: -2, width: 1, height: 3 }, [1]],
    [
      'keeps the old ceil end for a fractional size at an integer start',
      4,
      { x: 0, y: 0, width: 1.5, height: 1.2 },
      [0, 1, 4, 5],
    ],
    [
      'returns at once for absurd coordinates',
      3,
      { x: -1e12, y: -1e12, width: 2e12, height: 2e12 },
      [0, 1, 2, 3, 4, 5, 6, 7, 8],
    ],
  ])('%s', (_, size, area, expected) => {
    const image = generatePng(size, size);

    applyIgnoreAreas(image, [area]);

    expect(masked(image)).toEqual(expected);
  });

  it('skips null, empty and non-numeric areas', () => {
    const image = generatePng(3, 3);

    applyIgnoreAreas(image, [
      null,
      { x: 1, y: 1, width: 0, height: 2 },
      { x: NaN, y: 0, width: 2, height: 2 },
    ] as unknown as IgnoreAreaDto[]);

    expect(masked(image)).toEqual([]);
  });

  it('masks byte for byte what the old loop masked for integer areas', () => {
    let seed = 12345;
    const next = (min: number, max: number): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return min + Math.floor((seed / 4294967296) * (max - min));
    };

    for (let i = 0; i < 300; i++) {
      const area = { x: next(0, 12), y: next(-5, 12), width: next(-3, 12), height: next(-3, 12) };
      const legacy = new PNG({ width: 9, height: 7 });
      const current = new PNG({ width: 9, height: 7 });
      distinctPixels(9, 7).copy(legacy.data);
      distinctPixels(9, 7).copy(current.data);

      legacyApply(legacy, [area]);
      applyIgnoreAreas(current, [area]);

      expect(current.data.equals(legacy.data)).toBe(true);
    }
  });
});

describe('scaleImageToSize', () => {
  it.each([
    ['the requested size equals the image size', 3, 2, 3, 2],
    ['only the height is requested smaller', 3, 3, 3, 2],
  ])('returns the same image when %s', (_, imageWidth, imageHeight, width, height) => {
    const image = generatePng(imageWidth, imageHeight);

    expect(scaleImageToSize(image, width, height)).toBe(image);
  });

  it.each([
    ['wider', [2, 1], [3, 1], [0, 100, 200, 50, 1, 101, 199, 51, 0, 0, 0, 0]],
    ['taller', [1, 1], [1, 2], [0, 100, 200, 50, 0, 0, 0, 0]],
  ])('pads a %s canvas with transparent black, keeping the original pixels top-left', (_, from, to, expected) => {
    const image = new PNG({ width: from[0], height: from[1] });
    distinctPixels(from[0], from[1]).copy(image.data);

    const result = scaleImageToSize(image, to[0], to[1]);

    expect(result).not.toBe(image);
    expect([result.width, result.height]).toEqual(to);
    expect([...result.data]).toEqual(expected);
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
    expect([...result.data]).toEqual([...pixelOf(source.data, 0), ...pixelOf(source.data, 3)]);
  });
});
