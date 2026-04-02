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
    it('returns a signed URL for the requested object', async () => {
      const service = new AWSS3Service();
      (getSignedUrl as jest.Mock).mockResolvedValue('https://signed-url');

      const result = await service.getImageUrl('image.png');

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'vrt-bucket',
        Key: 'image.png',
      });
      expect(getSignedUrl).toHaveBeenCalledWith(
        (service as any).s3Client,
        {
          input: {
            Bucket: 'vrt-bucket',
            Key: 'image.png',
          },
          type: 'get',
        },
        { expiresIn: 3600 }
      );
      expect(result).toBe('https://signed-url');
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
