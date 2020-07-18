import { Module } from '@nestjs/common';
import { TestRunsService } from './test-runs.service';
import { SharedModule } from '../shared/shared.module';
import { PrismaService } from '../prisma/prisma.service';
import { TestRunsController } from './test-runs.controller';
import { TestVariationsModule } from '../test-variations/test-variations.module';

@Module({
  imports: [SharedModule, TestVariationsModule],
  providers: [TestRunsService, PrismaService],
  exports: [TestRunsService],
  controllers: [TestRunsController]
})
export class TestRunsModule {}
