import { Project } from '@prisma/client';
import { TEST_PROJECT } from '../_data_';
import { keepStoredApiKey, maskApiKey, maskProjectApiKey } from './api-key-mask';

const KEY = 'AIzaSyD-secret-gemini-key-1234';
const config = (extra: object) => JSON.stringify({ provider: 'gemini', model: 'gemini-2.5-flash', ...extra });
const withConfig = (imageComparisonConfig: string): Project => ({ ...TEST_PROJECT, imageComparisonConfig });

describe('maskApiKey', () => {
  it('keeps only the last 4 characters', () => {
    expect(maskApiKey(KEY)).toBe('••••1234');
  });

  it.each(['', 'abc', 'short-key12'])('hides a short key %p entirely', (key) => {
    expect(maskApiKey(key)).toBe('••••');
  });
});

describe('maskProjectApiKey', () => {
  it('masks the apiKey and keeps the rest of the config', () => {
    const project = withConfig(config({ apiKey: KEY, temperature: 0.2 }));

    const masked = maskProjectApiKey(project);

    expect(JSON.parse(masked.imageComparisonConfig)).toEqual({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      apiKey: '••••1234',
      temperature: 0.2,
    });
    expect({ ...masked, imageComparisonConfig: undefined }).toEqual({ ...project, imageComparisonConfig: undefined });
    expect(JSON.parse(project.imageComparisonConfig).apiKey).toBe(KEY);
  });

  it.each([
    ['without an apiKey', '{ "threshold": 0.1 }'],
    ['with an apiKey that is not a string', config({ apiKey: 42 })],
    ['that is not JSON', '{not json'],
    ['that is a JSON array', '[1]'],
    ['that is JSON null', 'null'],
  ])('returns the project as is for a config %s', (_case, imageComparisonConfig) => {
    const project = withConfig(imageComparisonConfig);

    expect(maskProjectApiKey(project)).toBe(project);
  });
});

describe('keepStoredApiKey', () => {
  const stored = config({ apiKey: KEY });

  it('puts the stored key back when the mask of it comes in', () => {
    const incoming = config({ apiKey: '••••1234', temperature: 0.5 });

    expect(JSON.parse(keepStoredApiKey(incoming, stored))).toEqual({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      apiKey: KEY,
      temperature: 0.5,
    });
  });

  it.each([
    ['a new key', config({ apiKey: 'AIzaSy-new-key-9999' })],
    ['a mask of another key', config({ apiKey: '••••9999' })],
    ['no key', config({})],
    ['a config that is not JSON', '{not json'],
  ])('keeps %s as sent', (_case, incoming) => {
    expect(keepStoredApiKey(incoming, stored)).toBe(incoming);
  });

  it.each([
    ['no stored config', undefined],
    ['a stored config without a key', config({})],
    ['a stored config that is not JSON', '{not json'],
  ])('keeps a mask as sent when there is %s', (_case, storedConfig) => {
    const incoming = config({ apiKey: '••••' });

    expect(keepStoredApiKey(incoming, storedConfig)).toBe(incoming);
  });
});
