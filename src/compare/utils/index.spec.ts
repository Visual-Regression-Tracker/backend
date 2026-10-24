import { PNG } from 'pngjs';
import { IgnoreAreaDto } from '../../test-runs/dto/ignore-area.dto';
import { generatePng } from '../../_data_';
import { Logger } from '@nestjs/common';
import { applyIgnoreAreas, parseConfig } from '.';

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
