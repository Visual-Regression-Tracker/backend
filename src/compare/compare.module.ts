import { Module } from '@nestjs/common';
import { CompareService } from './compare.service';
import { LookSameService } from './libs/looks-same/looks-same.service';
import { OdiffService } from './libs/odiff/odiff.service';
import { PixelmatchService } from './libs/pixelmatch/pixelmatch.service';
import { StaticModule } from '../static/static.module';

@Module({
  providers: [CompareService, PixelmatchService, LookSameService, OdiffService],
  imports: [StaticModule],
  exports: [CompareService],
})
export class CompareModule {}
