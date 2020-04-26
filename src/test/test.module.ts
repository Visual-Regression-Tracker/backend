import { Module } from '@nestjs/common';
import { TestService } from './test.service';
import { TestController } from './test.controller';
import { TestVariationsService } from 'src/test-variations/test-variations.service';
import { TestRunsService } from 'src/test-runs/test-runs.service';
import { SharedModule } from 'src/shared/shared.module';
import { SequelizeModule } from '@nestjs/sequelize';
import { TestRun } from 'src/test-runs/testRun.entity';
import { TestVariation } from 'src/test-variations/testVariation.entity';
import { UsersModule } from 'src/users/users.module';
import { TestRunsModule } from 'src/test-runs/test-runs.module';
import { TestVariationsModule } from 'src/test-variations/test-variations.module';

@Module({
  imports: [SharedModule, UsersModule, TestRunsModule, TestVariationsModule],
  providers: [TestService],
  controllers: [TestController],
  exports: [TestService]
})
export class TestModule {}
