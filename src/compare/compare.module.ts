import { forwardRef, Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { TestVariationsModule } from '../test-variations/test-variations.module';
import { TestRunsModule } from '../test-runs/test-runs.module';
import { CompareService } from './compare.service';
import { SharedModule } from '../shared/shared.module';
import { PixelmatchService } from './libs/pixelmatch.service';

@Module({
  imports: [
    forwardRef(() => TestRunsModule),
    // forwardRef(() => TestVariationsModule),
    // forwardRef(() => ProjectsModule),
    SharedModule,
  ],
  providers: [CompareService, PixelmatchService],
})
export class CompareModule {}
