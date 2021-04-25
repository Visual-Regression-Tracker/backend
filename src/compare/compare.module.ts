import { Module } from '@nestjs/common';
import { CompareService } from './compare.service';
import { PixelmatchService } from './libs/pixelmatch.service';

@Module({
  providers: [CompareService, PixelmatchService],
  exports: [CompareService],
})
export class CompareModule {}
