import { Project } from '@prisma/client';
import { TEST_PROJECT } from '../_data_';
import { lastValueFrom, of } from 'rxjs';
import {
  hasMaskedApiKey,
  keepStoredApiKey,
  maskApiKey,
  MaskApiKeyInterceptor,
  maskProjectApiKey,
} from './api-key-mask';

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

  it.each([undefined, null, 'id', { imageComparisonConfig: 42 }])('returns %p as is', (value) => {
    expect(maskProjectApiKey(value)).toBe(value);
  });
});

describe('MaskApiKeyInterceptor', () => {
  const intercept = (body: unknown) =>
    lastValueFrom(new MaskApiKeyInterceptor().intercept(undefined, { handle: () => of(body) }));
  const project = withConfig(config({ apiKey: KEY }));
  const masked = withConfig(config({ apiKey: '••••1234' }));

  it('masks the key of a project in the response', async () => {
    await expect(intercept(project)).resolves.toEqual(masked);
  });

  it('masks the keys of a list of projects', async () => {
    await expect(intercept([project, withConfig('{}')])).resolves.toEqual([masked, withConfig('{}')]);
  });

  it('passes a response that holds no project through', async () => {
    await expect(intercept(['a', 'b'])).resolves.toEqual(['a', 'b']);
    await expect(intercept(undefined)).resolves.toBeUndefined();
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
    ['no key', config({})],
    ['a config that is not JSON', '{not json'],
  ])('keeps %s as sent', (_case, incoming) => {
    expect(keepStoredApiKey(incoming, stored)).toBe(incoming);
  });

  it.each(['••••9999', '••••'])('puts the stored key back for a mask of an older key %p', (mask) => {
    expect(JSON.parse(keepStoredApiKey(config({ apiKey: mask }), stored)).apiKey).toBe(KEY);
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

describe('hasMaskedApiKey', () => {
  it.each([
    [config({ apiKey: '••••1234' }), true],
    [config({ apiKey: '••••' }), true],
    [config({ apiKey: KEY }), false],
    [config({}), false],
    ['{not json', false],
  ])('%s: %s', (incoming, masked) => {
    expect(hasMaskedApiKey(incoming)).toBe(masked);
  });
});
