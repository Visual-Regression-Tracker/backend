import { Test, TestingModule } from '@nestjs/testing';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';

describe('StatisticsController', () => {
  let controller: StatisticsController;
  const statisticsService = { getResults: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StatisticsController],
      providers: [{ provide: StatisticsService, useValue: statisticsService }],
    }).compile();
    controller = module.get(StatisticsController);
  });

  it('passes the project and branch to the service', async () => {
    const results = [{ id: 'a' }];
    statisticsService.getResults.mockResolvedValue(results);

    await expect(controller.getResults({ projectId: 'p1', branchName: 'dev' })).resolves.toBe(results);
    expect(statisticsService.getResults).toHaveBeenCalledWith('p1', 'dev');
  });

  it('passes no branch when none is given', async () => {
    statisticsService.getResults.mockResolvedValue([]);

    await controller.getResults({ projectId: 'p1' });
    expect(statisticsService.getResults).toHaveBeenCalledWith('p1', undefined);
  });
});
