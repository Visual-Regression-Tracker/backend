import { TestingModule, Test } from '@nestjs/testing';
import { TestStatus } from '@prisma/client';
import { PNG } from 'pngjs';
import { mocked } from 'ts-jest/utils';
import { StaticService } from '../../../shared/static/static.service';
import { DEFAULT_CONFIG, LookSameService } from './looks-same.service';
import { LooksSameConfig } from './looks-same.types';

const initService = async ({ getImageMock = jest.fn(), saveImageMock = jest.fn(), deleteImageMock = jest.fn() }) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      LookSameService,
      {
        provide: StaticService,
        useValue: {
          getImage: getImageMock,
          saveImage: saveImageMock,
          deleteImage: deleteImageMock,
        },
      },
    ],
  }).compile();

  return module.get<LookSameService>(LookSameService);
};

let service: LookSameService;

describe('parseConfig', () => {
  it.each<[string, LooksSameConfig]>([
    [
      '{"strict":false,"tolerance":122.1,"antialiasingTolerance":2,"ignoreAntialiasing":true,"ignoreCaret":true,"allowDiffDimensions":true}',
      {
        strict: false,
        tolerance: 122.1,
        antialiasingTolerance: 2,
        ignoreAntialiasing: true,
        ignoreCaret: true,
        allowDiffDimensions: true,
      },
    ],
    ['', DEFAULT_CONFIG],
    ['invalid', DEFAULT_CONFIG],
  ])('should parse config', async (json, expected) => {
    service = await initService({});

    const config = service.parseConfig(json);

    expect(config).toStrictEqual(expected);
  });
});
