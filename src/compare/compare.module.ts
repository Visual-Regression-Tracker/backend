import { Module } from '@nestjs/common';
import { CompareService } from './compare.service';
import { LookSameService } from './libs/looks-same/looks-same.service';
import { OdiffService } from './libs/odiff/odiff.service';
import { PixelmatchService } from './libs/pixelmatch/pixelmatch.service';
import { VlmService } from './libs/vlm/vlm.service';
import { OllamaController } from './libs/vlm/ollama.controller';
import { OllamaService } from './libs/vlm/ollama.service';
import { StaticModule } from '../static/static.module';

@Module({
  controllers: [OllamaController],
  providers: [CompareService, PixelmatchService, LookSameService, OdiffService, VlmService, OllamaService],
  imports: [StaticModule],
  exports: [CompareService],
})
export class CompareModule {}
