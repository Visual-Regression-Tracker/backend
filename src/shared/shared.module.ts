import { Global, Module } from '@nestjs/common';
import { StaticService } from './static/static.service';
import { EventsGateway } from '../shared/events/events.gateway';
import { PrismaService } from '../prisma/prisma.service';

@Global()
@Module({
  providers: [StaticService, EventsGateway, PrismaService],
  exports: [StaticService, EventsGateway, PrismaService],
  imports: [],
  controllers: [],
})
export class SharedModule {}
