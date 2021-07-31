import { PNG } from 'pngjs';
import { IgnoreAreaDto } from '../../test-runs/dto/ignore-area.dto';
import { generatePng } from '../../_data_';
import { applyIgnoreAreas } from '.';

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
