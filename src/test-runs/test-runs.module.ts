import { forwardRef, Module } from '@nestjs/common';
import { TestRunsService } from './test-runs.service';
import { TestRunRevertService } from './test-run-revert.service';
import { TestRunMatchingService } from './test-run-matching.service';
import { SharedModule } from '../shared/shared.module';
import { TestRunsController } from './test-runs.controller';
import { TestVariationsModule } from '../test-variations/test-variations.module';
import { CompareModule } from '../compare/compare.module';
import { StaticModule } from '../static/static.module';

@Module({
  imports: [SharedModule, forwardRef(() => TestVariationsModule), CompareModule, StaticModule],
  providers: [TestRunsService, TestRunRevertService, TestRunMatchingService],
  controllers: [TestRunsController],
  exports: [TestRunsService],
})
export class TestRunsModule {}
