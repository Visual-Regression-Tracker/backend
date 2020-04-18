import { Module } from '@nestjs/common';
import { TestsController } from './tests.controller';
import { TestsService } from './tests.service';
import { SequelizeModule } from '@nestjs/sequelize';
import { Test } from './test.entity';

@Module({
  imports: [SequelizeModule.forFeature([Test])],
  controllers: [TestsController],
  providers: [TestsService],
})
export class TestsModule {}
