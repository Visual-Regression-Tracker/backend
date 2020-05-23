import { Module } from '@nestjs/common';
import { TestVariationsService } from './test-variations.service';
import { TestVariationsController } from './test-variations.controller';
import { TestRunsModule } from 'src/test-runs/test-runs.module';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  providers: [TestVariationsService, PrismaService],
  controllers: [TestVariationsController],
  exports: [TestVariationsService]
})
export class TestVariationsModule {}
