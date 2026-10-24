import { randomBytes } from 'crypto';

// Crockford's base32 digits: no I, L, O or U, so a key read aloud or retyped
// is not mistaken. The alphabet of the keys issued before (uuid-apikey).
const CROCKFORD_DIGITS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_LENGTH = 28;

/**
 * A random 28-character key in the format API keys and image names have
 * always had — Crockford base32, upper case, no dashes — so keys issued
 * before keep working and clients see no change. Each character carries 5
 * random bits (140 in all, more than the 122 a v4 UUID gave).
 */
export function generateRandomKey(): string {
  const bytes = randomBytes(KEY_LENGTH);
  let key = '';
  for (const byte of bytes) {
    // 256 is a multiple of 32, so taking the low 5 bits keeps every digit equally likely
    key += CROCKFORD_DIGITS[byte & 31];
  }
  return key;
}

/**
 * Whether a project reference is an id rather than a name: dashes where a
 * UUID has its first three, and 32 characters without them. The check
 * uuid-apikey made, so references resolve as they did; an empty string is
 * simply not a UUID instead of an exception.
 */
export function isUuidShaped(value: string): boolean {
  return (
    !!value &&
    value.charAt(8) === '-' &&
    value.charAt(13) === '-' &&
    value.charAt(18) === '-' &&
    value.replace(/-/g, '').length === 32
  );
}
