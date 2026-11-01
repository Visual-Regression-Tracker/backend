import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Readable } from 'stream';
import { PNG } from 'pngjs';
import { StaticService } from './static.service';
import { ConfigService } from '@nestjs/config';
import { StaticModule } from './static.module';
import { StaticFactoryService } from './static.factory';
import { Static } from './static.interface';
import { ImageTooLargeException } from './utils';

describe('StaticService', () => {
  let service: StaticService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ConfigService,
          useValue: {},
        },
      ],
      imports: [StaticModule],
    }).compile();

    service = module.get<StaticService>(StaticService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('delegation to the configured backend', () => {
    const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let backend: { [K in keyof Static]: jest.Mock };
    let factory: { getStaticService: jest.Mock };

    beforeEach(() => {
      backend = {
        saveImage: jest.fn().mockResolvedValue('saved.png'),
        getImageBuffer: jest.fn().mockResolvedValue(Buffer.from('bytes')),
        getImageStream: jest.fn().mockResolvedValue(Readable.from([])),
        copyImage: jest.fn().mockResolvedValue('copied.png'),
        deleteImage: jest.fn().mockResolvedValue(true),
        getImageUrl: jest.fn().mockResolvedValue('https://storage/image.png'),
      };
      factory = { getStaticService: jest.fn().mockReturnValue(backend) };
      service = new StaticService(factory as unknown as StaticFactoryService);
    });

    it('asks the factory for the backend once, at construction', async () => {
      await service.getImageUrl('a.png');
      await service.getImageUrl('b.png');

      expect(factory.getStaticService).toHaveBeenCalledTimes(1);
    });

    it('saves a real PNG through the backend', async () => {
      const png = PNG.sync.write(new PNG({ width: 1, height: 1 }));

      await expect(service.saveImage('screenshot', png)).resolves.toBe('saved.png');
      expect(backend.saveImage).toHaveBeenCalledWith('screenshot', png);
    });

    it('accepts any buffer that starts with the PNG signature', async () => {
      const signatureOnly = Buffer.concat([PNG_SIGNATURE, Buffer.from('not really a png')]);

      await expect(service.saveImage('diff', signatureOnly)).resolves.toBe('saved.png');
    });

    describe('image size limit', () => {
      const originalPixels = process.env.MAX_IMAGE_PIXELS;

      afterEach(() => {
        if (originalPixels === undefined) {
          delete process.env.MAX_IMAGE_PIXELS;
        } else {
          process.env.MAX_IMAGE_PIXELS = originalPixels;
        }
      });

      it('rejects a screenshot above MAX_IMAGE_PIXELS with 422 before reaching the backend', async () => {
        process.env.MAX_IMAGE_PIXELS = '5';
        const png = PNG.sync.write(new PNG({ width: 3, height: 2 }));

        await expect(service.saveImage('screenshot', png)).rejects.toBeInstanceOf(ImageTooLargeException);
        expect(backend.saveImage).not.toHaveBeenCalled();
      });

      it('stores a baseline or a diff of any size', async () => {
        process.env.MAX_IMAGE_PIXELS = '5';
        const png = PNG.sync.write(new PNG({ width: 3, height: 2 }));

        await expect(service.saveImage('baseline', png)).resolves.toBe('saved.png');
        await expect(service.saveImage('diff', png)).resolves.toBe('saved.png');
      });
    });

    it.each([
      ['an empty buffer', Buffer.alloc(0)],
      ['a truncated signature', PNG_SIGNATURE.subarray(0, 7)],
      ['a JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0])],
    ])('rejects %s without reaching the backend', async (_label, buffer) => {
      const result = service.saveImage('baseline', buffer);

      await expect(result).rejects.toBeInstanceOf(BadRequestException);
      await expect(result).rejects.toThrow('Cannot parse image as PNG file');
      expect(backend.saveImage).not.toHaveBeenCalled();
    });

    it('delegates getImageStream', async () => {
      const stream = Readable.from([]);
      backend.getImageStream.mockResolvedValue(stream);

      await expect(service.getImageStream('a.png')).resolves.toBe(stream);
      expect(backend.getImageStream).toHaveBeenCalledWith('a.png');
    });

    it.each([
      ['getImageBuffer', ['a.png'], Buffer.from('bytes')],
      ['copyImage', ['baseline', 'a.png'], 'copied.png'],
      ['deleteImage', ['a.png'], true],
      ['getImageUrl', ['a.png'], 'https://storage/image.png'],
    ] as const)('delegates %s', async (method, args, result) => {
      await expect((service[method] as (...a: readonly string[]) => Promise<unknown>)(...args)).resolves.toEqual(
        result
      );
      expect(backend[method]).toHaveBeenCalledWith(...args);
    });

    it('deleteImages skips empty names and deletes the rest', async () => {
      await service.deleteImages(['a.png', null, '', undefined, 'b.png']);

      expect(backend.deleteImage.mock.calls).toEqual([['a.png'], ['b.png']]);
    });

    it('deleteImages accepts any iterable and caps the concurrency', async () => {
      let running = 0;
      let peak = 0;
      backend.deleteImage.mockImplementation(async () => {
        peak = Math.max(peak, ++running);
        await new Promise((resolve) => setImmediate(resolve));
        running--;
        return true;
      });

      await service.deleteImages(new Set(['1', '2', '3', '4', '5']), 2);

      expect(backend.deleteImage).toHaveBeenCalledTimes(5);
      expect(peak).toBe(2);
    });

    it('deleteImages rejects when a delete fails', async () => {
      backend.deleteImage.mockRejectedValue(new Error('disk gone'));

      await expect(service.deleteImages(['a.png'])).rejects.toThrow('disk gone');
    });

    it('passes backend failures through', async () => {
      backend.getImageBuffer.mockRejectedValue(new Error('EACCES'));

      await expect(service.getImageBuffer('a.png')).rejects.toThrow('EACCES');
    });
  });
});
