import { Test } from '@nestjs/testing';
import { TestStatus } from '@prisma/client';
import { StaticService } from '../../../static/static.service';
import { DiffWorkerPool } from '../../diff-worker-pool';
import { Dinov2Service } from '../dinov2/dinov2.service';
import { DEFAULT_CONFIG, PixelmatchService } from './pixelmatch.service';

const diffBuffer = Buffer.from('diff');
const imageThumbnail = Buffer.from('image-thumb');
const diffThumbnail = Buffer.from('diff-thumb');

const initService = async (output: Record<string, unknown>) => {
  const saveImage = jest
    .fn()
    .mockResolvedValueOnce('diff.png')
    .mockResolvedValueOnce('image-thumb.png')
    .mockResolvedValueOnce('diff-thumb.png');
  const module = await Test.createTestingModule({
    providers: [
      PixelmatchService,
      { provide: DiffWorkerPool, useValue: { run: jest.fn().mockResolvedValue(output) } },
      { provide: Dinov2Service, useValue: { confirmsNoise: jest.fn() } },
      {
        provide: StaticService,
        useValue: { getImageBuffer: jest.fn().mockResolvedValue(Buffer.from('png')), saveImage },
      },
    ],
  }).compile();
  return { service: module.get(PixelmatchService), saveImage };
};

const input = (diffTollerancePercent: number) => ({
  baseline: 'baseline',
  image: 'image',
  diffTollerancePercent,
  ignoreAreas: [],
  saveDiffAsFile: true,
});

describe('PixelmatchService.getDiff tolerance boundary', () => {
  const output = {
    equal: false,
    isSameDimension: true,
    pixelMisMatchCount: 10,
    diffPercent: 1,
    diffBuffer,
    imageThumbnail,
    diffThumbnail,
  };

  it('is ok and saves nothing when the percent equals the tolerance', async () => {
    const { service, saveImage } = await initService(output);

    const result = await service.getDiff(input(1), DEFAULT_CONFIG);

    expect(result.status).toBe(TestStatus.ok);
    expect(result.diffName).toBeNull();
    expect(saveImage).not.toHaveBeenCalled();
  });

  it('is unresolved and saves the diff and both thumbnails just over the tolerance', async () => {
    const { service, saveImage } = await initService(output);

    const result = await service.getDiff(input(0.99), DEFAULT_CONFIG);

    expect(result.status).toBe(TestStatus.unresolved);
    expect(result.diffName).toBe('diff.png');
    expect(result.imageThumbnailName).toBe('image-thumb.png');
    expect(result.diffThumbnailName).toBe('diff-thumb.png');
    expect(saveImage.mock.calls).toEqual([
      ['diff', diffBuffer],
      ['screenshot', imageThumbnail],
      ['diff', diffThumbnail],
    ]);
  });
});
