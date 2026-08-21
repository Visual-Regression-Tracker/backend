import { HddService } from './hdd.service';

describe('HddService', () => {
  const service = new HddService();

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

  it('returns null for a missing image', async () => {
    await expect(service.getImageBuffer('definitely-missing.png')).resolves.toBeNull();
  });

  it('propagates a traversal attempt instead of reading the file', async () => {
    await expect(service.getImageBuffer('../../etc/passwd')).rejects.toThrow(/outside of the image directory/);
  });
});
