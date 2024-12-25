import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StaticService } from './static.service';
import { StaticFactoryService } from './static.factory';

@Module({
  imports: [ConfigModule],
  providers: [StaticService, StaticFactoryService],
  exports: [StaticService],
})
export class StaticModule {}
