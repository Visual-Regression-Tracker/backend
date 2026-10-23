import uuidAPIKey from 'uuid-apikey';

export function isHddStaticServiceConfigured() {
  return !process.env.STATIC_SERVICE || process.env.STATIC_SERVICE === 'hdd';
}

export function isS3ServiceConfigured() {
  return !process.env.STATIC_SERVICE || process.env.STATIC_SERVICE === 's3';
}

export function generateNewImageName(type: 'screenshot' | 'diff' | 'baseline'): string {
  return `${uuidAPIKey.create({ noDashes: true }).apiKey}.${type}.png`;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Signature check instead of a full decode: parsing megapixel PNGs just to
// validate them blocks the event loop on every upload.
export function isPngBuffer(imageBuffer: Buffer): boolean {
  return (
    imageBuffer.length >= PNG_SIGNATURE.length && imageBuffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  );
}
