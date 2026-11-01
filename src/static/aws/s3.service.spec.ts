import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { AWSS3Service, URL_WINDOW_SECONDS } from './s3.service';
import { generateNewImageName } from '../utils';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input, type: 'put' })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input, type: 'get' })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input, type: 'delete' })),
  CopyObjectCommand: jest.fn().mockImplementation((input) => ({ input, type: 'copy' })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

jest.mock('../utils', () => ({
  generateNewImageName: jest.fn(),
}));

const notFound = (props: object) => Object.assign(new Error('not found'), props);
const notFoundCases = [
  ['a NoSuchKey error', { name: 'NoSuchKey' }],
  ['an HTTP 404', { $metadata: { httpStatusCode: 404 } }],
] as const;
const defaultTimeouts = {
  requestHandler: { connectionTimeout: 5000, requestTimeout: 60000, throwOnRequestTimeout: true },
};

describe('AWSS3Service', () => {
  const originalAwsBucket = process.env.AWS_S3_BUCKET_NAME;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AWS_S3_BUCKET_NAME = 'vrt-bucket';
    mockSend.mockResolvedValue({});
    (getSignedUrl as jest.Mock).mockResolvedValue('https://signed-url');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env.AWS_S3_BUCKET_NAME = originalAwsBucket;
  });

  describe('saveImage', () => {
    it('uploads the image buffer and returns the generated image name', async () => {
      (generateNewImageName as jest.Mock).mockReturnValue('generated.screenshot.png');
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

  describe('getImageUrl', () => {
    const signingDateOfLastCall = (): Date => (getSignedUrl as jest.Mock).mock.calls.at(-1)[2].signingDate;

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('returns a signed URL for the requested object', async () => {
      const service = new AWSS3Service();

      const result = await service.getImageUrl('image.png');

      expect(result).toBe('https://signed-url');
      expect(GetObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({ Bucket: 'vrt-bucket', Key: 'image.png' })
      );
    });

    it('signs for twice the window, from the start of the current window, with a matching cache header', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-01T10:42:31.500Z'));
      const service = new AWSS3Service();

      await service.getImageUrl('image.png');

      expect(URL_WINDOW_SECONDS).toBe(3600);
      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'vrt-bucket',
        Key: 'image.png',
        ResponseCacheControl: 'private, max-age=3600',
      });
      expect(getSignedUrl).toHaveBeenCalledWith(expect.objectContaining({ send: mockSend }), expect.anything(), {
        expiresIn: 7200,
        signingDate: new Date('2026-09-01T10:00:00.000Z'),
      });
    });

    it('signs against "undefined" when no bucket is configured (startup warns about it)', async () => {
      delete process.env.AWS_S3_BUCKET_NAME;
      const service = new AWSS3Service();

      await service.getImageUrl('image.png');

      expect(GetObjectCommand).toHaveBeenCalledWith(expect.objectContaining({ Bucket: 'undefined' }));
    });

    it.each([
      ['hands out the same URL for an image asked for again soon after', '10:00:05', '10:42:31', true],
      ['moves on to a new URL once the window has passed', '10:42:31', '11:00:01', false],
    ])('%s', async (_, firstTime, secondTime, same) => {
      const service = new AWSS3Service();
      const nowSpy = jest.spyOn(Date, 'now');

      nowSpy.mockReturnValue(Date.parse(`2026-09-01T${firstTime}Z`));
      await service.getImageUrl('image.png');
      const first = signingDateOfLastCall();

      nowSpy.mockReturnValue(Date.parse(`2026-09-01T${secondTime}Z`));
      await service.getImageUrl('image.png');

      expect(first).toBeInstanceOf(Date);
      if (same) {
        expect(signingDateOfLastCall()).toEqual(first);
      } else {
        expect(signingDateOfLastCall()).not.toEqual(first);
      }
    });

    it('keeps a URL alive well past the window it was signed in', async () => {
      const service = new AWSS3Service();
      const lastSecondOfWindow = Date.parse('2026-09-01T10:59:59Z');
      jest.spyOn(Date, 'now').mockReturnValue(lastSecondOfWindow);

      await service.getImageUrl('image.png');

      const { expiresIn, signingDate } = (getSignedUrl as jest.Mock).mock.calls.at(-1)[2];
      const livesUntil = signingDate.getTime() + expiresIn * 1000;
      expect(livesUntil - lastSecondOfWindow).toBeGreaterThanOrEqual(3600 * 1000);
    });

    it('asks S3 to answer with a cache header', async () => {
      const service = new AWSS3Service();

      await service.getImageUrl('image.png');

      expect(GetObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({ ResponseCacheControl: expect.stringContaining('max-age=') })
      );
    });
  });

  describe('constructor', () => {
    it('creates one S3 client with the default credential chain and request timeouts', () => {
      delete process.env.S3_CONNECTION_TIMEOUT_MS;
      delete process.env.S3_REQUEST_TIMEOUT_MS;

      new AWSS3Service();

      expect(S3Client).toHaveBeenCalledTimes(1);
      expect(S3Client).toHaveBeenCalledWith(defaultTimeouts);
    });

    it('reads the timeouts from S3_CONNECTION_TIMEOUT_MS and S3_REQUEST_TIMEOUT_MS', () => {
      process.env.S3_CONNECTION_TIMEOUT_MS = '2000';
      process.env.S3_REQUEST_TIMEOUT_MS = '1000';

      new AWSS3Service();

      expect(S3Client).toHaveBeenCalledWith({
        requestHandler: { connectionTimeout: 2000, requestTimeout: 1000, throwOnRequestTimeout: true },
      });
    });

    it.each(['abc', '', '0', '-5'])('falls back to the default timeout for %p', (value) => {
      process.env.S3_CONNECTION_TIMEOUT_MS = value;
      process.env.S3_REQUEST_TIMEOUT_MS = value;

      new AWSS3Service();

      expect(S3Client).toHaveBeenCalledWith(defaultTimeouts);
    });

    it('reads the bucket name when the service is constructed, not on each call', async () => {
      const service = new AWSS3Service();
      process.env.AWS_S3_BUCKET_NAME = 'changed-later';

      await service.deleteImage('image.png');

      expect(DeleteObjectCommand).toHaveBeenCalledWith({ Bucket: 'vrt-bucket', Key: 'image.png' });
    });
  });

  describe('getImageBuffer', () => {
    it.each(['', undefined, null])('returns null for an empty name (%p) without calling S3', async (fileName) => {
      const service = new AWSS3Service();

      await expect(service.getImageBuffer(fileName as string | null)).resolves.toBeNull();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('concatenates the body stream of the object', async () => {
      const service = new AWSS3Service();
      const stream = { toArray: jest.fn().mockResolvedValue([Buffer.from('ab'), Buffer.from('cd')]) };
      mockSend.mockResolvedValue({ Body: stream });

      await expect(service.getImageBuffer('image.png')).resolves.toEqual(Buffer.from('abcd'));
      expect(mockSend).toHaveBeenCalledWith({ input: { Bucket: 'vrt-bucket', Key: 'image.png' }, type: 'get' });
    });

    it.each(notFoundCases)('returns null for %s', async (_label, props) => {
      const service = new AWSS3Service();
      jest.spyOn((service as any).logger, 'error').mockImplementation();
      mockSend.mockRejectedValue(notFound(props));

      await expect(service.getImageBuffer('missing.png')).resolves.toBeNull();
    });

    it('rethrows any other failure after logging it', async () => {
      const service = new AWSS3Service();
      const loggerSpy = jest.spyOn((service as any).logger, 'error').mockImplementation();
      const error = Object.assign(new Error('Access Denied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      });
      mockSend.mockRejectedValue(error);

      await expect(service.getImageBuffer('image.png')).rejects.toBe(error);
      expect(loggerSpy).toHaveBeenCalledWith(
        'Error from read : Cannot get image: image.png. AccessDenied: Access Denied'
      );
    });

    it('rethrows a non-Error rejection', async () => {
      const service = new AWSS3Service();
      jest.spyOn((service as any).logger, 'error').mockImplementation();
      mockSend.mockRejectedValue('boom');

      await expect(service.getImageBuffer('image.png')).rejects.toBe('boom');
    });
  });

  describe('getImageStream', () => {
    it('returns the body of the object without reading it', async () => {
      const service = new AWSS3Service();
      const body = Readable.from([Buffer.from('ab')]);
      mockSend.mockResolvedValue({ Body: body });

      await expect(service.getImageStream('image.png')).resolves.toBe(body);
      expect(mockSend).toHaveBeenCalledWith({ input: { Bucket: 'vrt-bucket', Key: 'image.png' }, type: 'get' });
    });

    it('returns null when the response has no body', async () => {
      const service = new AWSS3Service();

      await expect(service.getImageStream('image.png')).resolves.toBeNull();
    });

    it.each(notFoundCases)('returns null for %s', async (_label, props) => {
      const service = new AWSS3Service();
      mockSend.mockRejectedValue(notFound(props));

      await expect(service.getImageStream('missing.png')).resolves.toBeNull();
    });

    it('rethrows any other failure', async () => {
      const service = new AWSS3Service();
      const error = Object.assign(new Error('Access Denied'), { name: 'AccessDenied' });
      mockSend.mockRejectedValue(error);

      await expect(service.getImageStream('image.png')).rejects.toBe(error);
    });
  });

  describe('copyImage', () => {
    it('copies the source object inside the bucket under a newly generated name', async () => {
      (generateNewImageName as jest.Mock).mockReturnValue('generated.baseline.png');
      const service = new AWSS3Service();

      await expect(service.copyImage('baseline', 'source.png')).resolves.toBe('generated.baseline.png');

      expect(generateNewImageName).toHaveBeenCalledWith('baseline');
      expect(CopyObjectCommand).toHaveBeenCalledWith({
        Bucket: 'vrt-bucket',
        CopySource: 'vrt-bucket/source.png',
        Key: 'generated.baseline.png',
      });
      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'copy' }));
    });

    it('wraps copy failures', async () => {
      (generateNewImageName as jest.Mock).mockReturnValue('generated.baseline.png');
      mockSend.mockRejectedValue(new Error('copy failed'));
      const service = new AWSS3Service();

      await expect(service.copyImage('baseline', 'source.png')).rejects.toThrow(
        'Could not copy file at AWS S3 : Error: copy failed'
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
