import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { PassThrough, Readable } from 'stream';
import { StaticController } from './static.controller';
import { StaticService } from './static.service';
import { generateNewImageName } from './utils';

const IMAGE = 'ABCDEFGHJKMNPQRSTVWXYZ012345.screenshot.png';

const ACCEPTED_NAMES = [
  generateNewImageName('screenshot'),
  generateNewImageName('diff'),
  generateNewImageName('baseline'),
  '1612345678901.screenshot.png',
  'V1StGXR8_Z5jdHi6B-myT.diff.png',
  '0123456789ABCDEFGHJKMNPQRSTV.baseline.png',
];

const REJECTED_NAMES = [
  '\\evil.com',
  '/\\evil.com',
  'image.png',
  'a.b.screenshot.png',
  'x.screenshot.png.exe',
  '..',
  '.',
  '',
  '../../etc/passwd',
  'nested/image.png',
  '/etc/passwd',
  '/example.com',
  '//example.com',
];

const initController = async (getImageStreamMock = jest.fn(), getImageUrlMock = jest.fn()) => {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [StaticController],
    providers: [
      {
        provide: StaticService,
        useValue: { getImageStream: getImageStreamMock, getImageUrl: getImageUrlMock },
      },
    ],
  }).compile();

  return module.get<StaticController>(StaticController);
};

const responseMock = () => {
  const res = { set: jest.fn(), send: jest.fn(), redirect: jest.fn(), status: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response & { set: jest.Mock; send: jest.Mock; redirect: jest.Mock; status: jest.Mock };
};

const streamResponse = () => {
  const res = Object.assign(new PassThrough(), { set: jest.fn() });
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  return { res: res as unknown as Response & { set: jest.Mock }, body: () => Buffer.concat(chunks) };
};

describe('download', () => {
  it('streams the image bytes', async () => {
    const getImageStreamMock = jest.fn().mockResolvedValueOnce(Readable.from([Buffer.from([1, 2]), Buffer.from([3])]));
    const controller = await initController(getImageStreamMock);
    const { res, body } = streamResponse();

    await controller.download(IMAGE, res);

    expect(getImageStreamMock).toHaveBeenCalledWith(IMAGE);
    expect(res.set).toHaveBeenCalledWith({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${IMAGE}"`,
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    expect(body()).toEqual(Buffer.from([1, 2, 3]));
  });

  it('answers 404 for an image that is not there', async () => {
    const getImageStreamMock = jest.fn().mockResolvedValueOnce(null);
    const controller = await initController(getImageStreamMock);
    const { res } = streamResponse();

    await expect(controller.download(IMAGE, res)).rejects.toThrow(new NotFoundException(`Image not found: ${IMAGE}`));
    expect(res.set).not.toHaveBeenCalled();
  });

  it('warns instead of throwing when the stream fails midway', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const failing = new Readable({
      read() {
        this.push(Buffer.from([1]));
        this.destroy(new Error('disk gone'));
      },
    });
    const controller = await initController(jest.fn().mockResolvedValueOnce(failing));
    const { res } = streamResponse();

    await expect(controller.download(IMAGE, res)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`Download of ${IMAGE} stopped`));
    warnSpy.mockRestore();
  });

  it.each(ACCEPTED_NAMES)('accepts the generated name %s', async (fileName) => {
    const controller = await initController(jest.fn().mockResolvedValueOnce(Readable.from([Buffer.from([1])])));
    const { res } = streamResponse();

    await expect(controller.download(fileName, res)).resolves.toBeUndefined();
  });

  it.each(REJECTED_NAMES)('rejects %p without touching storage', async (fileName) => {
    const getImageStreamMock = jest.fn();
    const controller = await initController(getImageStreamMock);

    await expect(controller.download(fileName, responseMock())).rejects.toThrow(BadRequestException);
    expect(getImageStreamMock).not.toHaveBeenCalled();
  });
});

describe('getUrlAndRedirect', () => {
  it('lets the browser reuse the redirect for exactly 3000 seconds, short of the signed URL expiry', async () => {
    const controller = await initController(jest.fn(), jest.fn().mockResolvedValueOnce('https://storage/image.png'));
    const res = responseMock();

    await controller.getUrlAndRedirect(IMAGE, res);

    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, max-age=3000');
    expect(res.redirect).toHaveBeenCalledWith('https://storage/image.png');
    expect(res.set.mock.invocationCallOrder[0]).toBeLessThan(res.redirect.mock.invocationCallOrder[0]);
  });

  it('answers 500 with a plain message when the storage cannot produce a URL', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const error = new Error('signing failed');
    const controller = await initController(jest.fn(), jest.fn().mockRejectedValueOnce(error));
    const res = responseMock();

    await controller.getUrlAndRedirect(IMAGE, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('Error occurred while getting the file.');
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.set).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(`Error fetching file from S3:${IMAGE}`, error);
    errorSpy.mockRestore();
  });

  it.each(ACCEPTED_NAMES)('accepts the generated name %s', async (fileName) => {
    const controller = await initController(jest.fn(), jest.fn().mockResolvedValueOnce('https://storage/x'));
    const res = responseMock();

    await controller.getUrlAndRedirect(fileName, res);

    expect(res.redirect).toHaveBeenCalledWith('https://storage/x');
  });

  it.each(REJECTED_NAMES)('refuses %p before asking storage for a URL', async (fileName) => {
    const getImageUrlMock = jest.fn();
    const controller = await initController(jest.fn(), getImageUrlMock);
    const res = responseMock();

    await expect(controller.getUrlAndRedirect(fileName, res)).rejects.toThrow(
      new BadRequestException('Invalid image name')
    );
    expect(getImageUrlMock).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
