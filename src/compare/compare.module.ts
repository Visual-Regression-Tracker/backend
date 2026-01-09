import { Module } from '@nestjs/common';
import { CompareService } from './compare.service';
import { LookSameService } from './libs/looks-same/looks-same.service';
import { OdiffService } from './libs/odiff/odiff.service';
import { PixelmatchService } from './libs/pixelmatch/pixelmatch.service';
import { VlmService } from './libs/vlm/vlm.service';
import { OllamaController } from './libs/vlm/providers/ollama/ollama.controller';
import { OllamaService } from './libs/vlm/providers/ollama/ollama.service';
import { GeminiService } from './libs/vlm/providers/gemini/gemini.service';
import { StaticModule } from '../static/static.module';

@Module({
  controllers: [OllamaController],
  providers: [
    CompareService,
    PixelmatchService,
    LookSameService,
    OdiffService,
    VlmService,
    OllamaService,
    GeminiService,
  ],
  imports: [StaticModule],
  exports: [CompareService],
})
export class CompareModule {}
