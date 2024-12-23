import { forwardRef, Global, Module } from '@nestjs/common';
import { STATIC_SERVICE, StaticService } from './static/static-service.interface';
import { EventsGateway } from '../shared/events/events.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from './tasks/tasks.service';
import { TestVariationsModule } from '../test-variations/test-variations.module';
import { StaticController } from './static/static.controller';
import { AWSS3Service } from './static/aws-s3.servce.';
import { HardDiskService } from './static/hard-disk.service';

@Global()
@Module({
  providers: [
    {
      provide: STATIC_SERVICE,
      useFactory: (): StaticService => {
        const isAWSDefined = process.env.USE_AWS_S3_BUCKET?.trim().toLowerCase() === 'true';
        return isAWSDefined ? new AWSS3Service() : new HardDiskService();
      },
    },
    AWSS3Service,
    HardDiskService,
    EventsGateway,
    PrismaService,
    TasksService,
  ],
  exports: [STATIC_SERVICE, EventsGateway, PrismaService],
  imports: [forwardRef(() => TestVariationsModule)],
  controllers: [StaticController],
})
export class SharedModule {}
