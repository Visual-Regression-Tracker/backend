import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { StaticController } from './static.controller';
import { StaticService } from './static.service';

const initController = async (getImageBufferMock = jest.fn(), getImageUrlMock = jest.fn()) => {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [StaticController],
    providers: [
      {
        provide: StaticService,
        useValue: { getImageBuffer: getImageBufferMock, getImageUrl: getImageUrlMock },
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

describe('download', () => {
  it('answers with the image bytes', async () => {
    const imageBuffer = Buffer.from([1, 2, 3]);
    const getImageBufferMock = jest.fn().mockResolvedValueOnce(imageBuffer);
    const controller = await initController(getImageBufferMock);
    const res = responseMock();

    await controller.download('image.png', res);

    expect(getImageBufferMock).toHaveBeenCalledWith('image.png');
    expect(res.set).toHaveBeenCalledWith({
      'Content-Type': 'image/png',
      'Content-Disposition': 'attachment; filename="image.png"',
    });
    expect(res.send).toHaveBeenCalledWith(imageBuffer);
  });

  it('answers 404 for an image that is not there', async () => {
    const getImageBufferMock = jest.fn().mockResolvedValueOnce(null);
    const controller = await initController(getImageBufferMock);

    await expect(controller.download('missing.png', responseMock())).rejects.toThrow(NotFoundException);
  });

  // a name carrying a path could otherwise read any file the process can see
  it.each(['../../etc/passwd', '..', '.', '', 'nested/image.png', '/etc/passwd'])(
    'rejects %p without touching storage',
    async (fileName) => {
      const getImageBufferMock = jest.fn();
      const controller = await initController(getImageBufferMock);

      await expect(controller.download(fileName, responseMock())).rejects.toThrow(BadRequestException);
      expect(getImageBufferMock).not.toHaveBeenCalled();
    }
  );
});

describe('getUrlAndRedirect', () => {
  // Without this the browser asks the API for a location on every single view.
  // Storage then hands back a freshly signed, and therefore different, URL, and
  // the image it already holds is dead weight — every view a fresh download.
  it('lets the browser reuse the redirect it was given', async () => {
    const getImageUrlMock = jest.fn().mockResolvedValueOnce('https://storage/image.png');
    const controller = await initController(jest.fn(), getImageUrlMock);
    const res = responseMock();

    await controller.getUrlAndRedirect('image.png', res);

    expect(res.set).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('max-age='));
    expect(res.redirect).toHaveBeenCalledWith('https://storage/image.png');
  });

  // the redirect may not outlive the URL it points at
  it('stops reusing the redirect before the signed URL can expire', async () => {
    const controller = await initController(jest.fn(), jest.fn().mockResolvedValueOnce('https://storage/image.png'));
    const res = responseMock();

    await controller.getUrlAndRedirect('image.png', res);

    const [, value] = res.set.mock.calls.find(([header]) => header === 'Cache-Control');
    expect(Number(/max-age=(\d+)/.exec(value)[1])).toBeLessThan(3600);
  });

  it('sets a private cache header of exactly 3000 seconds before redirecting', async () => {
    const controller = await initController(jest.fn(), jest.fn().mockResolvedValueOnce('https://storage/image.png'));
    const res = responseMock();

    await controller.getUrlAndRedirect('image.png', res);

    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, max-age=3000');
    expect(res.set.mock.invocationCallOrder[0]).toBeLessThan(res.redirect.mock.invocationCallOrder[0]);
  });

  it('answers 500 with a plain message when the storage cannot produce a URL', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const error = new Error('signing failed');
    const controller = await initController(jest.fn(), jest.fn().mockRejectedValueOnce(error));
    const res = responseMock();

    await controller.getUrlAndRedirect('image.png', res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('Error occurred while getting the file.');
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.set).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('Error fetching file from S3:image.png', error);
    errorSpy.mockRestore();
  });

  // a leading slash would come back as a protocol-relative Location such as
  // '//example.com', sending the browser to another host
  it.each(['/example.com', '//example.com', 'nested/image.png', '..', '.', ''])(
    'refuses %p before asking storage for a URL',
    async (fileName) => {
      const getImageUrlMock = jest.fn();
      const controller = await initController(jest.fn(), getImageUrlMock);
      const res = responseMock();

      await expect(controller.getUrlAndRedirect(fileName, res)).rejects.toThrow(
        new BadRequestException('Invalid image name')
      );
      expect(getImageUrlMock).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    }
  );
});
