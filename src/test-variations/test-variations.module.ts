import { forwardRef, Module } from '@nestjs/common';
import { TestVariationsService } from './test-variations.service';
import { TestVariationsController } from './test-variations.controller';
import { PrismaService } from '../prisma/prisma.service';
import { TestRunsModule } from '../test-runs/test-runs.module';
import { BuildsModule } from '../builds/builds.module';
import { SharedModule } from 'src/shared/shared.module';

@Module({
  imports: [forwardRef(() => TestRunsModule), forwardRef(() => BuildsModule)],
  providers: [TestVariationsService, PrismaService],
  controllers: [TestVariationsController],
  exports: [TestVariationsService],
})
export class TestVariationsModule {}
