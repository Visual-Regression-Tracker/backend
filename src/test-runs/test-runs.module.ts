import { Module } from '@nestjs/common';
import { TestRunsService } from './test-runs.service';
import { SharedModule } from 'src/shared/shared.module';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  imports: [SharedModule],
  providers: [TestRunsService, PrismaService],
  exports: [TestRunsService]
})
export class TestRunsModule {}
