import { generateTestRun, generateTestVariation } from '../_data_';
import { getTestVariationUniqueData } from '.';

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
