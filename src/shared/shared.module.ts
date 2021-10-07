import { forwardRef, Global, HttpModule, Module } from '@nestjs/common';
import { StaticService } from './static/static.service';
import { EventsGateway } from '../shared/events/events.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from './tasks/tasks.service';
import { TestVariationsModule } from '../test-variations/test-variations.module';
import { VRTUserLogService } from './user-logs/user-log.service';

@Global()
@Module({
  providers: [StaticService, EventsGateway, PrismaService, TasksService, VRTUserLogService],
  exports: [StaticService, EventsGateway, PrismaService],
  imports: [forwardRef(() => TestVariationsModule), HttpModule],
  controllers: [],
})
export class SharedModule { }
