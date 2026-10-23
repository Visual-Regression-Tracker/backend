import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
  const res = { set: jest.fn(), send: jest.fn(), redirect: jest.fn() };
  return res as unknown as Response & { set: jest.Mock; send: jest.Mock; redirect: jest.Mock };
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
});
