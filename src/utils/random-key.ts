import { randomBytes } from 'crypto';

const CROCKFORD_DIGITS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_LENGTH = 28;

export function generateRandomKey(): string {
  const bytes = randomBytes(KEY_LENGTH);
  let key = '';
  for (const byte of bytes) {
    key += CROCKFORD_DIGITS[byte & 31];
  }
  return key;
}

export function isUuidShaped(value: string): boolean {
  return (
    !!value &&
    value.charAt(8) === '-' &&
    value.charAt(13) === '-' &&
    value.charAt(18) === '-' &&
    value.replace(/-/g, '').length === 32
  );
}
