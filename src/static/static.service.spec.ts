import { Test, TestingModule } from '@nestjs/testing';
import { StaticService } from './static.service';
import { ConfigService } from '@nestjs/config';
import { StaticModule } from './static.module';

describe('StaticService', () => {
  let service: StaticService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ConfigService,
          useValue: {},
        },
      ],
      imports: [StaticModule],
    }).compile();

    service = module.get<StaticService>(StaticService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
