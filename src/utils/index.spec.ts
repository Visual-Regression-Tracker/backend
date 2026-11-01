import { generateTestRun, generateTestVariation } from '../_data_';
import { getTestVariationUniqueData, parseIgnoreAreas, testRunImageNames, variationKey } from '.';

describe('getTestVariationUniqueData', () => {
  it('picks the fields that identify a test variation', () => {
    const variation = generateTestVariation({
      name: 'login page',
      os: 'macOS',
      device: 'iPhone',
      browser: 'webkit',
      viewport: '375x812',
      customTags: 'dark',
    });

    expect(getTestVariationUniqueData(variation)).toStrictEqual({
      name: 'login page',
      os: 'macOS',
      device: 'iPhone',
      browser: 'webkit',
      viewport: '375x812',
      customTags: 'dark',
    });
  });

  it('turns null and undefined optional fields into empty strings but keeps the name as is', () => {
    const testRun = generateTestRun({
      name: undefined,
      os: null,
      device: undefined,
      browser: null,
      viewport: null,
      customTags: null,
    });

    expect(getTestVariationUniqueData(testRun)).toStrictEqual({
      name: undefined,
      os: '',
      device: '',
      browser: '',
      viewport: '',
      customTags: '',
    });
  });

  it('leaves out the branch name and fills fields a baseline request omits', () => {
    expect(getTestVariationUniqueData({ name: 'card', branchName: 'develop' })).toStrictEqual({
      name: 'card',
      os: '',
      device: '',
      browser: '',
      viewport: '',
      customTags: '',
    });
  });
});

describe('parseIgnoreAreas', () => {
  it('returns the stored areas', () => {
    const areas = [{ x: 1, y: 2, width: 3, height: 4 }];

    expect(parseIgnoreAreas(JSON.stringify(areas))).toEqual(areas);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['JSON null', 'null'],
    ['an object', '{}'],
    ['a string', '"str"'],
    ['text that is not JSON', 'not json'],
  ])('treats %s as no areas', (_case, stored) => {
    expect(parseIgnoreAreas(stored)).toEqual([]);
  });

  it('drops entries that are not objects', () => {
    expect(parseIgnoreAreas('[1,null,{"x":1}]')).toEqual([{ x: 1 }]);
  });
});

describe('testRunImageNames', () => {
  it('lists every stored file of a run', () => {
    expect(
      testRunImageNames({
        imageName: 'i.png',
        diffName: 'd.png',
        imageThumbnailName: 'it.png',
        diffThumbnailName: 'dt.png',
      }).sort()
    ).toEqual(['d.png', 'dt.png', 'i.png', 'it.png']);
  });

  it('drops missing and empty names', () => {
    expect(
      testRunImageNames({ imageName: 'i.png', diffName: null, imageThumbnailName: '', diffThumbnailName: null })
    ).toEqual(['i.png']);
  });
});

describe('variationKey', () => {
  it('names the project and branch next to the screen the source belongs to', () => {
    const source = {
      name: 'screen',
      os: 'linux',
      browser: null,
      device: undefined,
      viewport: '800x600',
      customTags: '',
    };

    expect(variationKey('projectId', 'feature', source as never)).toStrictEqual({
      projectId: 'projectId',
      branchName: 'feature',
      name: 'screen',
      os: 'linux',
      browser: '',
      device: '',
      viewport: '800x600',
      customTags: '',
    });
  });
});
