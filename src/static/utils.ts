import { UnprocessableEntityException } from '@nestjs/common';
import { crc32 } from 'zlib';
import { generateRandomKey } from '../utils/random-key';
import { nonNegativeNumber } from '../utils/env';
import type { ImageType } from './static.interface';

export function isHddStaticServiceConfigured() {
  return !process.env.STATIC_SERVICE || process.env.STATIC_SERVICE === 'hdd';
}

export function generateNewImageName(type: ImageType): string {
  return `${generateRandomKey()}.${type}.png`;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Signature only: fully decoding megapixel PNGs blocks the event loop on every upload
export function isPngBuffer(imageBuffer: Buffer): boolean {
  return (
    imageBuffer.length >= PNG_SIGNATURE.length && imageBuffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  );
}

export const DEFAULT_MAX_IMAGE_PIXELS = 100_000_000;

export function maxImagePixels(): number {
  return nonNegativeNumber(process.env.MAX_IMAGE_PIXELS, DEFAULT_MAX_IMAGE_PIXELS);
}

export function asBuffer(bytes: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function readPngDimensions(buffer: Buffer | Uint8Array): { width: number; height: number } | null {
  const b = asBuffer(buffer);
  if (!isPngBuffer(b) || b.length < 33) return null;
  if (b.readUInt32BE(8) !== 13 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

const CRITICAL_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

export function isWellFormedPng(buffer: Buffer | Uint8Array): boolean {
  const b = asBuffer(buffer);
  if (!readPngDimensions(b)) return false;
  const [bitDepth, colorType, compression, filter, interlace] = [b[24], b[25], b[26], b[27], b[28]];
  if (![1, 2, 4, 8, 16].includes(bitDepth) || ![0, 2, 3, 4, 6].includes(colorType)) return false;
  if (compression !== 0 || filter !== 0 || interlace > 1) return false;
  let offset = 8;
  while (offset + 12 <= b.length) {
    const length = b.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > b.length) return false;
    const type = b.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) return false;
    if (type[0] === type[0].toUpperCase() && !CRITICAL_CHUNKS.has(type)) return false;
    if (crc32(b.subarray(offset + 4, offset + 8 + length)) !== b.readUInt32BE(offset + 8 + length)) return false;
    if (type === 'IEND') return end === b.length;
    offset = end;
  }
  return false;
}

export function isByteEqualWellFormedPng(a: Buffer | Uint8Array, b: Buffer | Uint8Array): boolean {
  return asBuffer(a).equals(asBuffer(b)) && isWellFormedPng(a);
}

export class ImageTooLargeException extends UnprocessableEntityException {
  constructor(width: number, height: number, limit: number) {
    super(`Image is ${width}x${height} (${width * height} pixels), above MAX_IMAGE_PIXELS=${limit}`);
  }
}

export function assertWithinPixelLimit(width: number, height: number): void {
  const limit = maxImagePixels();
  if (limit > 0 && width * height > limit) {
    throw new ImageTooLargeException(width, height, limit);
  }
}

export function assertPngWithinPixelLimit(buffer: Buffer | Uint8Array): void {
  const size = readPngDimensions(buffer);
  if (size) assertWithinPixelLimit(size.width, size.height);
}
