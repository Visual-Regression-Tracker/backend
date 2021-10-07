import { forwardRef, HttpModule, Module } from '@nestjs/common';
import { TestRunsService } from './test-runs.service';
import { SharedModule } from '../shared/shared.module';
import { PrismaService } from '../prisma/prisma.service';
import { TestRunsController } from './test-runs.controller';
import { TestVariationsModule } from '../test-variations/test-variations.module';
import { CompareModule } from '../compare/compare.module';
import { VRTUserLogService } from 'src/shared/user-logs/user-log.service';

@Module({
  imports: [SharedModule, forwardRef(() => TestVariationsModule), CompareModule, HttpModule],
  providers: [TestRunsService, PrismaService, VRTUserLogService],
  controllers: [TestRunsController],
  exports: [TestRunsService],
})
export class TestRunsModule { }
