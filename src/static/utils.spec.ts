import { readFileSync } from 'fs';
import { join } from 'path';
import { crc32 } from 'zlib';
import { PNG } from 'pngjs';
import {
  asBuffer,
  assertPngWithinPixelLimit,
  assertWithinPixelLimit,
  DEFAULT_MAX_IMAGE_PIXELS,
  generateNewImageName,
  ImageTooLargeException,
  isByteEqualWellFormedPng,
  isHddStaticServiceConfigured,
  isPngBuffer,
  isWellFormedPng,
  maxImagePixels,
  readPngDimensions,
} from './utils';

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
    it.each<[string | undefined, boolean]>([
      [undefined, true],
      ['', true],
      ['hdd', true],
      ['s3', false],
      ['S3', false],
      ['gcs', false],
    ])('STATIC_SERVICE=%p: hdd %p', (value, hdd) => {
      if (value === undefined) {
        delete process.env.STATIC_SERVICE;
      } else {
        process.env.STATIC_SERVICE = value;
      }

      expect(isHddStaticServiceConfigured()).toBe(hdd);
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

    it.each([
      ['a buffer that is exactly the PNG signature', Buffer.from(signature)],
      ['a buffer that starts with the PNG signature', Buffer.from([...signature, 1, 2, 3])],
      ['a signature found at the start of a buffer view', Buffer.from([0, 0, ...signature, 9]).subarray(2)],
    ])('accepts %s', (_label, buffer) => {
      expect(isPngBuffer(buffer)).toBe(true);
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

  describe('PNG header helpers', () => {
    const tiny = () => PNG.sync.write(new PNG({ width: 3, height: 2 }));
    const viewOf = (png: Buffer) => {
      const view = new Uint8Array(png.length + 4);
      view.set(png, 4);
      return view.subarray(4);
    };
    const real = () => readFileSync(join(__dirname, '../../test/image.png'));
    const originalPixels = process.env.MAX_IMAGE_PIXELS;

    afterEach(() => {
      if (originalPixels === undefined) {
        delete process.env.MAX_IMAGE_PIXELS;
      } else {
        process.env.MAX_IMAGE_PIXELS = originalPixels;
      }
    });

    const refreshCrc = (b: Buffer, offset: number) => {
      const length = b.readUInt32BE(offset);
      b.writeUInt32BE(crc32(b.subarray(offset + 4, offset + 8 + length)), offset + 8 + length);
    };

    const chunk = (type: string, data: Buffer) => {
      const out = Buffer.alloc(12 + data.length);
      out.writeUInt32BE(data.length, 0);
      out.write(type, 4, 'latin1');
      data.copy(out, 8);
      out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
      return out;
    };

    describe('readPngDimensions', () => {
      it('reads the size from IHDR', () => {
        expect(readPngDimensions(tiny())).toStrictEqual({ width: 3, height: 2 });
      });

      it('accepts a Uint8Array view, as it arrives after postMessage', () => {
        expect(readPngDimensions(viewOf(tiny()))).toStrictEqual({ width: 3, height: 2 });
      });

      it.each([
        ['a buffer that is only a signature-less string', () => Buffer.from('png')],
        ['a buffer shorter than a header', () => tiny().subarray(0, 32)],
        ['a JPEG signature', () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)])],
        [
          'a first chunk that is not a 13-byte IHDR',
          () => {
            const png = tiny();
            png.write('IHDX', 12, 'latin1');
            return png;
          },
        ],
        [
          'a zero width',
          () => {
            const png = tiny();
            png.writeUInt32BE(0, 16);
            return png;
          },
        ],
      ])('returns null for %s', (_label, make) => {
        expect(readPngDimensions(make())).toBeNull();
      });
    });

    describe('asBuffer', () => {
      it('returns a Buffer as is', () => {
        const buffer = Buffer.from([1, 2, 3]);

        expect(asBuffer(buffer)).toBe(buffer);
      });

      it('wraps a Uint8Array view without copying or widening it', () => {
        const backing = new Uint8Array([9, 1, 2, 3, 9]);
        const view = backing.subarray(1, 4);

        const buffer = asBuffer(view);

        expect(Buffer.isBuffer(buffer)).toBe(true);
        expect([...buffer]).toEqual([1, 2, 3]);
        expect(buffer.buffer).toBe(backing.buffer);
      });
    });

    describe('isByteEqualWellFormedPng', () => {
      it('accepts two identical well-formed PNGs, Buffer or Uint8Array', () => {
        expect(isByteEqualWellFormedPng(tiny(), tiny())).toBe(true);
        expect(isByteEqualWellFormedPng(new Uint8Array(tiny()), tiny())).toBe(true);
      });

      it('rejects PNGs that differ', () => {
        const other = tiny();
        other[other.length - 20] ^= 0xff;

        expect(isByteEqualWellFormedPng(tiny(), other)).toBe(false);
      });

      it('rejects an identical pair that is not a well-formed PNG', () => {
        const truncated = tiny().subarray(0, tiny().length - 5);

        expect(isByteEqualWellFormedPng(truncated, Buffer.from(truncated))).toBe(false);
      });
    });

    describe('isWellFormedPng', () => {
      it.each([
        ['a generated PNG', tiny],
        ['a real screenshot', real],
      ])('accepts %s', (_label, make) => {
        expect(isWellFormedPng(make())).toBe(true);
      });

      it('accepts a Uint8Array view', () => {
        expect(isWellFormedPng(viewOf(tiny()))).toBe(true);
      });

      const withChunk = (type: string, tail = true) => {
        const png = tiny();
        return Buffer.concat([
          png.subarray(0, 33),
          chunk(type, Buffer.from([1, 2])),
          ...(tail ? [png.subarray(33)] : []),
        ]);
      };
      const withHeaderByte = (position: number, value: number) => () => {
        const png = tiny();
        png[position] = value;
        refreshCrc(png, 8);
        return png;
      };

      it.each([
        ['a file cut short by 5 bytes', () => tiny().subarray(0, tiny().length - 5)],
        ['a file that ends before IEND is complete, on a chunk boundary', () => tiny().subarray(0, tiny().length - 12)],
        [
          'a flipped bit in the middle (CRC mismatch)',
          () => {
            const png = tiny();
            png[Math.floor(png.length / 2)] ^= 0x01;
            return png;
          },
        ],
        ['an extra byte after IEND', () => Buffer.concat([tiny(), Buffer.from([0])])],
        ['a string', () => Buffer.from('png')],
        ['a bit depth PNG does not define', withHeaderByte(24, 3)],
        ['a color type PNG does not define', withHeaderByte(25, 5)],
        ['an unknown compression method', withHeaderByte(26, 1)],
        ['an unknown filter method', withHeaderByte(27, 1)],
        ['an unknown interlace method', withHeaderByte(28, 2)],
        ['an unknown critical chunk', () => withChunk('ABCD')],
        ['a chunk type that is not four letters', () => withChunk('ab1D')],
        [
          'a chunk that claims more data than the buffer holds',
          () => {
            const png = tiny();
            png.writeUInt32BE(0x7fffffff, 33);
            return png;
          },
        ],
        ['a file without IEND', () => withChunk('abCD', false)],
      ])('rejects %s', (_label, make) => {
        expect(isWellFormedPng(make())).toBe(false);
      });

      it('accepts an unknown ancillary chunk with a valid CRC', () => {
        expect(isWellFormedPng(withChunk('abCD'))).toBe(true);
      });
    });

    describe('maxImagePixels', () => {
      it('defaults to 100 million pixels', () => {
        delete process.env.MAX_IMAGE_PIXELS;

        expect(maxImagePixels()).toBe(DEFAULT_MAX_IMAGE_PIXELS);
        expect(DEFAULT_MAX_IMAGE_PIXELS).toBe(100_000_000);
      });

      it.each([
        ['0', 0],
        ['2500', 2500],
        ['abc', DEFAULT_MAX_IMAGE_PIXELS],
        ['-5', DEFAULT_MAX_IMAGE_PIXELS],
        ['  ', DEFAULT_MAX_IMAGE_PIXELS],
        ['', DEFAULT_MAX_IMAGE_PIXELS],
      ])('MAX_IMAGE_PIXELS=%p gives %p', (value, expected) => {
        process.env.MAX_IMAGE_PIXELS = value;

        expect(maxImagePixels()).toBe(expected);
      });
    });

    describe('assertPngWithinPixelLimit', () => {
      it('rejects a PNG above the limit with 422 and names its size', () => {
        process.env.MAX_IMAGE_PIXELS = '5';

        let error: unknown;
        try {
          assertPngWithinPixelLimit(tiny());
        } catch (e) {
          error = e;
        }

        expect(error).toBeInstanceOf(ImageTooLargeException);
        expect((error as ImageTooLargeException).getStatus()).toBe(422);
        expect((error as ImageTooLargeException).message).toContain('3x2');
      });

      it('lets a PNG exactly at the limit through', () => {
        process.env.MAX_IMAGE_PIXELS = '6';

        expect(() => assertPngWithinPixelLimit(tiny())).not.toThrow();
      });

      it('lets anything through when the limit is 0', () => {
        process.env.MAX_IMAGE_PIXELS = '0';

        expect(() => assertPngWithinPixelLimit(tiny())).not.toThrow();
        expect(() => assertWithinPixelLimit(100_000, 100_000)).not.toThrow();
      });

      it('leaves a malformed header to the decoder', () => {
        process.env.MAX_IMAGE_PIXELS = '1';

        expect(() => assertPngWithinPixelLimit(Buffer.from('png'))).not.toThrow();
      });

      it('rejects a tiny file whose header claims a huge canvas', () => {
        delete process.env.MAX_IMAGE_PIXELS;
        const png = tiny();
        png.writeUInt32BE(30000, 16);
        png.writeUInt32BE(30000, 20);

        expect(() => assertPngWithinPixelLimit(png)).toThrow(ImageTooLargeException);
      });
    });
  });
});
