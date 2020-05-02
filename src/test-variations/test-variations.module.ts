import { Module } from '@nestjs/common';
import { TestVariationsService } from './test-variations.service';
import { TestVariation } from './testVariation.entity';
import { SequelizeModule } from '@nestjs/sequelize';
import { TestVariationsController } from './test-variations.controller';
import { TestRunsModule } from 'src/test-runs/test-runs.module';

@Module({
  imports: [SequelizeModule.forFeature([TestVariation]), TestRunsModule],
  providers: [TestVariationsService],
  controllers: [TestVariationsController],
  exports: [TestVariationsService]
})
export class TestVariationsModule {}
