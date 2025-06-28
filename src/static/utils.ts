import uuidAPIKey from 'uuid-apikey';

export function isHddStaticServiceConfigured() {
  return !process.env.STATIC_SERVICE || process.env.STATIC_SERVICE === 'hdd';
}

export function isS3ServiceConfigured() {
  return !process.env.STATIC_SERVICE || process.env.STATIC_SERVICE === 's3';
}

export function generateNewImageName(type: 'screenshot' | 'diff' | 'baseline'): string {
    return`${uuidAPIKey.create({ noDashes: true }).apiKey}.${type}.png`;
  }