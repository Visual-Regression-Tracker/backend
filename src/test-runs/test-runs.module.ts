import { Module } from '@nestjs/common';
import { TestRunsService } from './test-runs.service';
import { SequelizeModule } from '@nestjs/sequelize';
import { TestRun } from './testRun.entity';
import { SharedModule } from 'src/shared/shared.module';

@Module({
  imports: [SequelizeModule.forFeature([TestRun]), SharedModule],
  providers: [TestRunsService],
  exports: [TestRunsService]
})
export class TestRunsModule {}
