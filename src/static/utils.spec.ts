import { generateNewImageName, isHddStaticServiceConfigured, isPngBuffer, isS3ServiceConfigured } from './utils';

describe('static utils', () => {
  const originalStaticService = process.env.STATIC_SERVICE;

  afterEach(() => {
    if (originalStaticService === undefined) {
      delete process.env.STATIC_SERVICE;
    } else {
      process.env.STATIC_SERVICE = originalStaticService;
    }
  });

  describe('storage detection from STATIC_SERVICE', () => {
    // NOTE: current behavior — with STATIC_SERVICE unset both helpers answer
    // true, and for an unknown value both answer false, while
    // StaticFactoryService falls back to HDD in both cases.
    it.each<[string | undefined, boolean, boolean]>([
      [undefined, true, true],
      ['', true, true],
      ['hdd', true, false],
      ['s3', false, true],
      ['S3', false, false],
      ['gcs', false, false],
    ])('STATIC_SERVICE=%p: hdd %p, s3 %p', (value, hdd, s3) => {
      if (value === undefined) {
        delete process.env.STATIC_SERVICE;
      } else {
        process.env.STATIC_SERVICE = value;
      }

      expect(isHddStaticServiceConfigured()).toBe(hdd);
      expect(isS3ServiceConfigured()).toBe(s3);
    });
  });

  describe('generateNewImageName', () => {
    it.each(['screenshot', 'diff', 'baseline'] as const)('names a %s image with a dashless api key', (type) => {
      const name = generateNewImageName(type);
      const [key, suffix, extension] = name.split('.');

      expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{28}$/);
      expect(suffix).toBe(type);
      expect(extension).toBe('png');
    });

    it('generates a different name on every call', () => {
      expect(generateNewImageName('diff')).not.toBe(generateNewImageName('diff'));
    });
  });

  describe('isPngBuffer', () => {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

    it('accepts a buffer that is exactly the PNG signature', () => {
      expect(isPngBuffer(Buffer.from(signature))).toBe(true);
    });

    it('accepts a buffer that starts with the PNG signature', () => {
      expect(isPngBuffer(Buffer.from([...signature, 1, 2, 3]))).toBe(true);
    });

    it('accepts a signature found at the start of a buffer view', () => {
      const backing = Buffer.from([0, 0, ...signature, 9]);

      expect(isPngBuffer(backing.subarray(2))).toBe(true);
    });

    it.each([
      ['an empty buffer', []],
      ['a truncated signature', signature.slice(0, 7)],
      ['one wrong byte', [...signature.slice(0, 7), 0x0b]],
      ['the signature not at the start', [0, ...signature]],
    ])('rejects %s', (_label, bytes) => {
      expect(isPngBuffer(Buffer.from(bytes))).toBe(false);
    });
  });
});
