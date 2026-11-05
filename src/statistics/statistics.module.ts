import { Module } from '@nestjs/common';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';

@Module({
  providers: [StatisticsService],
  controllers: [StatisticsController],
})
export class StatisticsModule {}
