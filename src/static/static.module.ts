import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StaticService } from './static.service';
import { StaticFactoryService } from './static.factory';
import { StaticController } from './static.controller';

@Module({
  imports: [ConfigModule],
  providers: [StaticService, StaticFactoryService],
  exports: [StaticService],
  controllers: [StaticController],
})
export class StaticModule {}
