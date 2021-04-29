import { forwardRef, Module } from '@nestjs/common';
import { TestRunsService } from './test-runs.service';
import { SharedModule } from '../shared/shared.module';
import { PrismaService } from '../prisma/prisma.service';
import { TestRunsController } from './test-runs.controller';
import { TestVariationsModule } from '../test-variations/test-variations.module';
import { CompareModule } from '../compare/compare.module';

@Module({
  imports: [SharedModule, forwardRef(() => TestVariationsModule), CompareModule],
  providers: [TestRunsService, PrismaService],
  controllers: [TestRunsController],
  exports: [TestRunsService],
})
export class TestRunsModule {}
