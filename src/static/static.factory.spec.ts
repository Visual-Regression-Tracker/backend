import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StaticFactoryService } from './static.factory';
import { HddService } from './hdd/hdd.service';
import { AWSS3Service } from './aws/s3.service';

describe('StaticFactoryService', () => {
  let service: StaticFactoryService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaticFactoryService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<StaticFactoryService>(StaticFactoryService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return HddService when STATIC_SERVICE is hdd', () => {
    jest.spyOn(configService, 'get').mockReturnValue('hdd');
    const result = service.getStaticService();
    expect(result).toBeInstanceOf(HddService);
  });

  it('should return AWSS3Service when STATIC_SERVICE is s3', () => {
    jest.spyOn(configService, 'get').mockReturnValue('s3');
    const result = service.getStaticService();
    expect(result).toBeInstanceOf(AWSS3Service);
  });

  it('should return HddService by default when STATIC_SERVICE is not set', () => {
    jest.spyOn(configService, 'get').mockReturnValue(undefined);
    const result = service.getStaticService();
    expect(result).toBeInstanceOf(HddService);
  });
});
