import { Module } from '@nestjs/common';
import { CompareService } from './compare.service';
import { LookSameService } from './libs/looks-same/looks-same.service';
import { PixelmatchService } from './libs/pixelmatch/pixelmatch.service';

@Module({
  providers: [CompareService, PixelmatchService, LookSameService],
  exports: [CompareService],
})
export class CompareModule {}
