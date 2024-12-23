import { Test, TestingModule } from '@nestjs/testing';
import { StaticService } from './static-service.interface';
import { ConfigService } from '@nestjs/config';
import { HardDiskService } from './hard-disk.service';

describe('StaticService', () => {
  let service: StaticService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HardDiskService,
        {
          provide: ConfigService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<StaticService>(HardDiskService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
