import { Module } from '@nestjs/common';
import { TestRunsService } from './test-runs.service';
import { SharedModule } from '../shared/shared.module';
import { PrismaService } from '../prisma/prisma.service';
import { TestRunsController } from './test-runs.controller';

@Module({
  imports: [SharedModule],
  providers: [TestRunsService, PrismaService],
  exports: [TestRunsService],
  controllers: [TestRunsController]
})
export class TestRunsModule {}
