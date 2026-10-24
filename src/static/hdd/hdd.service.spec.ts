import { Logger } from '@nestjs/common';
import { existsSync, mkdirSync, promises as fs, rmSync } from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { HDD_IMAGE_PATH } from './constants';
import { HddService } from './hdd.service';

// Keeps the spec out of the real imageUploads/ folder: the directory is a
// fresh temp one, still named imageUploads so the resolved paths look alike.
jest.mock('./constants', () => ({
  HDD_IMAGE_PATH: `${require('path').join(require('os').tmpdir(), `vrt-hdd-spec-${process.pid}`, 'imageUploads')}/`,
}));

const imageDir = path.resolve(HDD_IMAGE_PATH);
const pngBuffer = (width = 2, height = 1) => PNG.sync.write(new PNG({ width, height }));
const writeImage = (name: string, data: Buffer) => fs.writeFile(path.join(imageDir, name), data);

describe('HddService', () => {
  const service = new HddService();
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  afterAll(() => {
    rmSync(path.dirname(imageDir), { recursive: true, force: true });
  });

  it('stores images under imageUploads/ relative to the working directory', () => {
    expect(jest.requireActual('./constants').HDD_IMAGE_PATH).toBe('imageUploads/');
  });

  it('resolves a plain image name inside the image directory', () => {
    expect(service.getImagePath('ABC123.screenshot.png')).toMatch(/imageUploads\/ABC123\.screenshot\.png$/);
  });

  // a name may begin with dots without climbing out of the directory
  it.each(['..thumbnail.png', '...png', '.hidden.png'])(
    'resolves a dotted name inside the directory: %s',
    (imageName) => {
      expect(service.getImagePath(imageName)).toContain('imageUploads');
      expect(() => service.getImagePath(imageName)).not.toThrow();
    }
  );

  it.each(['../../etc/passwd', '../outside.png', '/etc/passwd', 'nested/../../outside.png', '..', '.'])(
    'rejects an image name pointing outside the image directory: %s',
    (imageName) => {
      expect(() => service.getImagePath(imageName)).toThrow(/outside of the image directory/);
    }
  );

  it('allows a name with a sub-directory that stays inside the image directory', () => {
    expect(service.getImagePath('nested/image.png')).toBe(path.join(imageDir, 'nested', 'image.png'));
  });

  it('creates the image directory when it does not exist yet', () => {
    rmSync(imageDir, { recursive: true, force: true });

    service.getImagePath('any.png');

    expect(existsSync(imageDir)).toBe(true);
  });

  it('returns null for a missing image', async () => {
    await expect(service.getImageBuffer('definitely-missing.png')).resolves.toBeNull();
  });

  it('propagates a traversal attempt instead of reading the file', async () => {
    await expect(service.getImageBuffer('../../etc/passwd')).rejects.toThrow(/outside of the image directory/);
  });

  describe('generateNewImage', () => {
    it('generates a unique name of the given type inside the image directory', () => {
      const { imageName, imagePath } = service.generateNewImage('diff');

      expect(imageName).toMatch(/^[0-9A-Z]{28}\.diff\.png$/);
      expect(imagePath).toBe(path.join(imageDir, imageName));
      expect(service.generateNewImage('diff').imageName).not.toBe(imageName);
    });
  });

  describe('getImageUrl', () => {
    it('returns the root-relative path the static assets are served from', async () => {
      await expect(service.getImageUrl('image.png')).resolves.toBe('/image.png');
    });

    // NOTE: current behavior — unlike the other methods, the name is not
    // checked for traversal here (the URL is only handed to the browser).
    it('does not validate the image name', async () => {
      await expect(service.getImageUrl('../secret')).resolves.toBe('/../secret');
    });
  });

  describe('saveImage', () => {
    it('writes the buffer to a newly named file and returns its name', async () => {
      const data = pngBuffer();

      const imageName = await service.saveImage('screenshot', data);

      expect(imageName).toMatch(/\.screenshot\.png$/);
      await expect(fs.readFile(path.join(imageDir, imageName))).resolves.toEqual(data);
    });

    it('writes only the bytes of a buffer that is a view into a larger allocation', async () => {
      const backing = Buffer.from('xxxxHELLOyyyy');
      const view = backing.subarray(4, 9);

      const imageName = await service.saveImage('baseline', view);

      await expect(fs.readFile(path.join(imageDir, imageName), 'utf8')).resolves.toBe('HELLO');
    });

    // NOTE: current behavior — HddService itself does not check the format;
    // only StaticService rejects non-PNG uploads.
    it('accepts a buffer that is not a PNG', async () => {
      const imageName = await service.saveImage('diff', Buffer.from('not a png'));

      await expect(fs.readFile(path.join(imageDir, imageName), 'utf8')).resolves.toBe('not a png');
    });
  });

  describe('getImage', () => {
    it('decodes a stored PNG', async () => {
      await writeImage('decodable.png', pngBuffer(3, 2));

      const image = await service.getImage('decodable.png');

      expect(image).toMatchObject({ width: 3, height: 2 });
    });

    it('returns undefined for a missing image', async () => {
      await expect(service.getImage('missing.png')).resolves.toBeUndefined();
    });

    it('returns undefined for an empty name', async () => {
      await expect(service.getImage('')).resolves.toBeUndefined();
    });

    it('logs and returns undefined for a file that is not a valid PNG', async () => {
      await writeImage('corrupt.png', Buffer.from('garbage'));

      await expect(service.getImage('corrupt.png')).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot decode image: corrupt.png.'));
    });
  });

  describe('getImageBuffer', () => {
    it('returns the stored bytes', async () => {
      await writeImage('bytes.png', Buffer.from([1, 2, 3]));

      await expect(service.getImageBuffer('bytes.png')).resolves.toEqual(Buffer.from([1, 2, 3]));
    });

    it.each(['', undefined, null])('returns null for an empty name (%p)', async (imageName) => {
      await expect(service.getImageBuffer(imageName)).resolves.toBeNull();
    });

    it('rethrows a read failure other than a missing file', async () => {
      mkdirSync(path.join(imageDir, 'a-directory.png'), { recursive: true });

      await expect(service.getImageBuffer('a-directory.png')).rejects.toMatchObject({ code: 'EISDIR' });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot get image: a-directory.png.'));
    });
  });

  describe('copyImage', () => {
    it('copies the source bytes to a newly named file of the given type', async () => {
      await writeImage('source.png', Buffer.from('source-bytes'));

      const imageName = await service.copyImage('baseline', 'source.png');

      expect(imageName).toMatch(/^[0-9A-Z]{28}\.baseline\.png$/);
      await expect(fs.readFile(path.join(imageDir, imageName), 'utf8')).resolves.toBe('source-bytes');
      await expect(fs.readFile(path.join(imageDir, 'source.png'), 'utf8')).resolves.toBe('source-bytes');
    });

    it('rejects when the source image is missing', async () => {
      await expect(service.copyImage('baseline', 'missing.png')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('rejects a source name pointing outside the image directory', async () => {
      await expect(service.copyImage('baseline', '../outside.png')).rejects.toThrow(/outside of the image directory/);
    });
  });

  describe('deleteImage', () => {
    it('removes the file and returns true', async () => {
      await writeImage('to-delete.png', Buffer.from('x'));

      await expect(service.deleteImage('to-delete.png')).resolves.toBe(true);
      expect(existsSync(path.join(imageDir, 'to-delete.png'))).toBe(false);
    });

    it('returns undefined for an empty name', async () => {
      await expect(service.deleteImage('')).resolves.toBeUndefined();
    });

    // NOTE: current behavior — failures are only logged and still reported as
    // a successful delete.
    it('logs and still returns true when the file is missing', async () => {
      await expect(service.deleteImage('never-existed.png')).resolves.toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ code: 'ENOENT' }));
    });

    it('logs and still returns true for a name pointing outside the image directory', async () => {
      await expect(service.deleteImage('../outside.png')).resolves.toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringMatching(/outside of the image directory/) })
      );
    });
  });
});
