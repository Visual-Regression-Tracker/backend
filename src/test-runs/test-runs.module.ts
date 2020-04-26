import { Module } from '@nestjs/common';
import { TestRunsService } from './test-runs.service';
import { SequelizeModule } from '@nestjs/sequelize';
import { TestRun } from './testRun.entity';
import { ConfigService } from 'src/shared/config/config.service';

@Module({
  imports: [SequelizeModule.forFeature([TestRun])],
  providers: [TestRunsService, ConfigService],
  exports: [TestRunsService]
})
export class TestRunsModule {}
