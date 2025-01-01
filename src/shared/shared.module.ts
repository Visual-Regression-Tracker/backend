import { forwardRef, Global, Module } from '@nestjs/common';
import { EventsGateway } from '../shared/events/events.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from './tasks/tasks.service';
import { TestVariationsModule } from '../test-variations/test-variations.module';

@Global()
@Module({
  providers: [EventsGateway, PrismaService, TasksService],
  exports: [EventsGateway, PrismaService],
  imports: [forwardRef(() => TestVariationsModule)],
  controllers: [],
})
export class SharedModule {}
