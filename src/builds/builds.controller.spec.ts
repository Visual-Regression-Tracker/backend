import { Test, TestingModule } from '@nestjs/testing';
import { BuildsController } from './builds.controller';

describe('Builds Controller', () => {
  let controller: BuildsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BuildsController],
    }).compile();

    controller = module.get<BuildsController>(BuildsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
