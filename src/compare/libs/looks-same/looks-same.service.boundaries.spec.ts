import { Test } from '@nestjs/testing';
import { TestStatus } from '@prisma/client';
import { PNG } from 'pngjs';
import { StaticService } from '../../../static/static.service';
import { DIFF_DIMENSION_RESULT } from '../consts';
import { DEFAULT_CONFIG, LookSameService } from './looks-same.service';

const filled = (width: number, height: number, value: number): PNG => {
  const image = new PNG({ width, height });
  image.data.fill(value);
  for (let i = 3; i < image.data.length; i += 4) {
    image.data[i] = 255;
  }
  return image;
};

const initService = async (baseline: PNG, image: PNG) => {
  const saveImage = jest.fn().mockResolvedValue('diff.png');
  const module = await Test.createTestingModule({
    providers: [
      LookSameService,
      {
        provide: StaticService,
        useValue: { getImage: jest.fn().mockResolvedValueOnce(baseline).mockResolvedValueOnce(image), saveImage },
      },
    ],
  }).compile();
  return { service: module.get(LookSameService), saveImage };
};

const input = { baseline: 'baseline', image: 'image', diffTollerancePercent: 0, ignoreAreas: [], saveDiffAsFile: true };

describe('LookSameService.getDiff dimensions', () => {
  it('reports a different height as a dimension change', async () => {
    const { service } = await initService(filled(10, 10, 0), filled(10, 5, 0));

    await expect(service.getDiff(input, DEFAULT_CONFIG)).resolves.toBe(DIFF_DIMENSION_RESULT);
  });

  it('reports a different width as a dimension change', async () => {
    const { service } = await initService(filled(10, 10, 0), filled(5, 10, 0));

    await expect(service.getDiff(input, DEFAULT_CONFIG)).resolves.toBe(DIFF_DIMENSION_RESULT);
  });
});

describe('LookSameService.getDiff saving the diff', () => {
  it('stores the diff as a "diff" image', async () => {
    const { service, saveImage } = await initService(filled(10, 10, 0), filled(10, 10, 255));

    const result = await service.getDiff(input, DEFAULT_CONFIG);

    expect(result.status).toBe(TestStatus.unresolved);
    expect(result.diffName).toBe('diff.png');
    expect(saveImage).toHaveBeenCalledWith('diff', expect.any(Buffer));
    expect(PNG.sync.read(saveImage.mock.calls[0][1]).width).toBe(10);
  });
});
