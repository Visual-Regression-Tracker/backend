import { randomUUID } from 'crypto';
import { generateRandomKey, isUuidShaped } from './random-key';

describe('generateRandomKey', () => {
  it('has the format keys were always issued in: 28 Crockford base32 digits, upper case', () => {
    expect(generateRandomKey()).toMatch(/^[0-9A-HJKMNP-TV-Z]{28}$/);
  });

  it('never repeats', () => {
    const keys = new Set(Array.from({ length: 1000 }, generateRandomKey));

    expect(keys.size).toBe(1000);
  });

  it('uses every digit', () => {
    const digits = new Set(Array.from({ length: 200 }, generateRandomKey).join(''));

    expect(digits.size).toBe(32);
  });
});

describe('isUuidShaped', () => {
  it.each([randomUUID(), randomUUID().toUpperCase(), '00000000-0000-0000-0000-000000000000'])(
    'takes %s for an id',
    (id) => {
      expect(isUuidShaped(id)).toBe(true);
    }
  );

  it.each([
    ['a project name', 'Default project'],
    ['an empty string', ''],
    ['a key without dashes', generateRandomKey()],
    ['dashes in other places', '0000-00000000-0000-0000-000000000000'],
    ['a UUID one character short', '00000000-0000-0000-0000-00000000000'],
  ])('takes %s for a name', (_, value) => {
    expect(isUuidShaped(value)).toBe(false);
  });
});
