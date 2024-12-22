import { forwardRef, Global, Module } from '@nestjs/common';
import { StaticService } from './static/static.service';
import { EventsGateway } from '../shared/events/events.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from './tasks/tasks.service';
import { TestVariationsModule } from '../test-variations/test-variations.module';
import { StaticController } from './static/static.controller';

@Global()
@Module({
  providers: [StaticService, EventsGateway, PrismaService, TasksService],
  exports: [StaticService, EventsGateway, PrismaService],
  imports: [forwardRef(() => TestVariationsModule)],
  controllers: [StaticController],
})
export class SharedModule {}
