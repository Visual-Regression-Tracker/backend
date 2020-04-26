import { Module } from '@nestjs/common';
import { TestVariationsService } from './test-variations.service';
import { TestVariation } from './testVariation.entity';
import { SequelizeModule } from '@nestjs/sequelize';
import { TestVariationsController } from './test-variations.controller';

@Module({
  imports: [SequelizeModule.forFeature([TestVariation])],
  providers: [TestVariationsService],
  controllers: [TestVariationsController],
  exports: [TestVariationsService]
})
export class TestVariationsModule {}
