import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PNG } from 'pngjs';
import { Readable } from 'stream';
import { AWSS3Service } from './s3.service';
import { generateNewImageName } from '../utils';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input, type: 'put' })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input, type: 'get' })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input, type: 'delete' })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

jest.mock('../utils', () => ({
  generateNewImageName: jest.fn(),
}));

describe('AWSS3Service', () => {
  const originalAwsBucket = process.env.AWS_S3_BUCKET_NAME;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AWS_S3_BUCKET_NAME = 'vrt-bucket';
  });

  afterAll(() => {
    process.env.AWS_S3_BUCKET_NAME = originalAwsBucket;
  });

  describe('saveImage', () => {
    it('uploads the image buffer and returns the generated image name', async () => {
      (generateNewImageName as jest.Mock).mockReturnValue('generated.screenshot.png');
      mockSend.mockResolvedValue({});
      const service = new AWSS3Service();
      const imageBuffer = Buffer.from('png-data');

      const result = await service.saveImage('screenshot', imageBuffer);

      expect(generateNewImageName).toHaveBeenCalledWith('screenshot');
      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'vrt-bucket',
        Key: 'generated.screenshot.png',
        ContentType: 'image/png',
        Body: imageBuffer,
      });
      expect(mockSend).toHaveBeenCalledWith({
        input: {
          Bucket: 'vrt-bucket',
          Key: 'generated.screenshot.png',
          ContentType: 'image/png',
          Body: imageBuffer,
        },
        type: 'put',
      });
      expect(result).toBe('generated.screenshot.png');
    });

    it('wraps upload failures', async () => {
      (generateNewImageName as jest.Mock).mockReturnValue('generated.diff.png');
      mockSend.mockRejectedValue(new Error('upload failed'));
      const service = new AWSS3Service();

      await expect(service.saveImage('diff', Buffer.from('png-data'))).rejects.toThrow(
        'Could not save file at AWS S3 : Error: upload failed'
      );
    });
  });

  describe('getImage', () => {
    it('returns null when the file name is missing', async () => {
      const service = new AWSS3Service();

      await expect(service.getImage('')).resolves.toBeNull();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('reads the image from S3 and parses it as PNG', async () => {
      const service = new AWSS3Service();
      const png = new PNG({ width: 1, height: 1 });
      const pngBuffer = PNG.sync.write(png);
      const stream = {
        toArray: jest.fn().mockResolvedValue([pngBuffer.subarray(0, 8), pngBuffer.subarray(8)]),
      } as unknown as Readable;
      mockSend.mockResolvedValue({ Body: stream });

      const result = await service.getImage('baseline.png');

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'vrt-bucket',
        Key: 'baseline.png',
      });
      expect(result).toMatchObject({ width: 1, height: 1 });
    });

    it('logs failures and returns undefined when the image cannot be read', async () => {
      const service = new AWSS3Service();
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation();
      mockSend.mockRejectedValue(new Error('download failed'));

      await expect(service.getImage('baseline.png')).resolves.toBeUndefined();

      expect(loggerSpy).toHaveBeenCalledWith(
        'Error from read : Cannot get image: baseline.png. Error: download failed'
      );
    });
  });

  describe('getImageUrl', () => {
    // A browser caches by URL. Signing from the current instant produced a
    // different URL on every request, so the bytes it had just downloaded
    // could never be reused and every view of an image cost a fresh download.
    const signingDateOfLastCall = (): Date => (getSignedUrl as jest.Mock).mock.calls.at(-1)[2].signingDate;

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('returns a signed URL for the requested object', async () => {
      const service = new AWSS3Service();
      (getSignedUrl as jest.Mock).mockResolvedValue('https://signed-url');

      const result = await service.getImageUrl('image.png');

      expect(result).toBe('https://signed-url');
      expect(GetObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({ Bucket: 'vrt-bucket', Key: 'image.png' })
      );
    });

    it('hands out the same URL for an image asked for again soon after', async () => {
      const service = new AWSS3Service();
      (getSignedUrl as jest.Mock).mockResolvedValue('https://signed-url');
      const nowSpy = jest.spyOn(Date, 'now');

      nowSpy.mockReturnValue(Date.parse('2026-09-01T10:00:05Z'));
      await service.getImageUrl('image.png');
      const first = signingDateOfLastCall();

      nowSpy.mockReturnValue(Date.parse('2026-09-01T10:42:31Z'));
      await service.getImageUrl('image.png');

      // asserted to be a real instant first: two undefineds are also equal
      expect(first).toBeInstanceOf(Date);
      expect(signingDateOfLastCall()).toEqual(first);
    });

    it('moves on to a new URL once the window has passed', async () => {
      const service = new AWSS3Service();
      (getSignedUrl as jest.Mock).mockResolvedValue('https://signed-url');
      const nowSpy = jest.spyOn(Date, 'now');

      nowSpy.mockReturnValue(Date.parse('2026-09-01T10:42:31Z'));
      await service.getImageUrl('image.png');
      const first = signingDateOfLastCall();

      nowSpy.mockReturnValue(Date.parse('2026-09-01T11:00:01Z'));
      await service.getImageUrl('image.png');

      expect(signingDateOfLastCall()).not.toEqual(first);
    });

    // a URL handed out at the very end of a window must still be usable for a
    // whole window afterwards, or the browser's cached copy outlives its URL
    it('keeps a URL alive well past the window it was signed in', async () => {
      const service = new AWSS3Service();
      (getSignedUrl as jest.Mock).mockResolvedValue('https://signed-url');

      await service.getImageUrl('image.png');

      const { expiresIn, signingDate } = (getSignedUrl as jest.Mock).mock.calls.at(-1)[2];
      const livesUntil = signingDate.getTime() + expiresIn * 1000;
      expect(livesUntil - Date.now()).toBeGreaterThanOrEqual(3600 * 1000);
    });

    // S3 answers with no cache headers of its own, so a stable URL alone still
    // leaves the browser guessing whether it may keep the bytes
    it('asks S3 to answer with a cache header', async () => {
      const service = new AWSS3Service();
      (getSignedUrl as jest.Mock).mockResolvedValue('https://signed-url');

      await service.getImageUrl('image.png');

      expect(GetObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({ ResponseCacheControl: expect.stringContaining('max-age=') })
      );
    });
  });

  describe('deleteImage', () => {
    it('returns false when the image name is missing', async () => {
      const service = new AWSS3Service();

      await expect(service.deleteImage('')).resolves.toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('deletes the object and returns true', async () => {
      const service = new AWSS3Service();
      mockSend.mockResolvedValue({});

      await expect(service.deleteImage('image.png')).resolves.toBe(true);

      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'vrt-bucket',
        Key: 'image.png',
      });
    });

    it('logs failures and returns false when deletion fails', async () => {
      const service = new AWSS3Service();
      const loggerSpy = jest.spyOn((service as any).logger, 'log').mockImplementation();
      const error = new Error('delete failed');
      mockSend.mockRejectedValue(error);

      await expect(service.deleteImage('image.png')).resolves.toBe(false);

      expect(loggerSpy).toHaveBeenCalledWith('Failed to delete file at AWS S3 for image image.png:', error);
    });
  });
});
