import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StaticService } from './static.service';
import { StaticFactoryService } from './static.factory';
import { StaticController } from './static.controller';
import { HddService } from './hdd/hdd.service';

@Module({
  imports: [ConfigModule],
  providers: [StaticService, StaticFactoryService, HddService],
  exports: [StaticService, HddService],
  controllers: [StaticController],
})
export class StaticModule {}
