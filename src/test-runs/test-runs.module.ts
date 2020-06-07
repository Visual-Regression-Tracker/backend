import { Module } from '@nestjs/common';
import { TestRunsService } from './test-runs.service';
import { SharedModule } from '../shared/shared.module';
import { PrismaService } from '../prisma/prisma.service';
import { TestRunsController } from './test-runs.controller';
import { EventsGateway } from 'src/events/events.gateway';

@Module({
  imports: [SharedModule],
  providers: [TestRunsService, PrismaService, EventsGateway],
  exports: [TestRunsService],
  controllers: [TestRunsController]
})
export class TestRunsModule {}
