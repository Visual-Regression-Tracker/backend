import { Module } from '@nestjs/common';
import { TestVariationsService } from './test-variations.service';
import { TestVariationsController } from './test-variations.controller';
import { PrismaService } from '../prisma/prisma.service';
import { TestRunsService } from '../test-runs/test-runs.service';
import { EventsGateway } from '../events/events.gateway';
import { BuildsService } from '../builds/builds.service';

@Module({
  providers: [TestVariationsService, PrismaService, TestRunsService, EventsGateway, BuildsService],
  controllers: [TestVariationsController],
  exports: [TestVariationsService],
})
export class TestVariationsModule {}
