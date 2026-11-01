import { Injectable, Logger } from '@nestjs/common';
import { TestStatus } from '@prisma/client';
import { StaticService } from '../../../static/static.service';
import { DiffResult } from '../../../test-runs/diffResult';
import { parseConfig } from '../../utils';
import { ConcurrencyLimiter } from './concurrency-limiter';
import { ImageComparator } from '../image-comparator.interface';
import { ImageCompareInput } from '../ImageCompareInput';
import { VlmConfig, OllamaVlmConfig } from './vlm.types';
import { VlmProvider, VlmProviderResponse } from './vlm-provider.interface';
import { VlmComparisonResultSchema } from './vlm-result.schema';
import { OllamaService } from './providers/ollama/ollama.service';
import { GeminiService } from './providers/gemini/gemini.service';
import { DiffWorkerPool } from '../../diff-worker-pool';
import { PixelmatchService, DEFAULT_CONFIG as PIXELMATCH_DEFAULT_CONFIG } from '../pixelmatch/pixelmatch.service';

export const DEFAULT_PROMPT = `You are provided with three images:
1. First image: baseline screenshot
2. Second image: new version screenshot
3. Diff image

Spot any difference in text, color, shape and position of elements - treat as different even slight change.
Ignore minor rendering artifacts that are imperceptible to users like antialiasing.
Describe the difference in about 100 words.`;

export const DEFAULT_CONFIG: OllamaVlmConfig = {
  provider: 'ollama',
  model: 'gemma3:12b',
  prompt: DEFAULT_PROMPT,
  temperature: 0.1,
  useThinking: false,
};

@Injectable()
export class VlmService implements ImageComparator {
  private readonly logger: Logger = new Logger(VlmService.name);
  readonly appliesBlurAmplitudeFilter = true;
  private readonly limiter = new ConcurrencyLimiter(4);

  constructor(
    private readonly staticService: StaticService,
    private readonly ollamaService: OllamaService,
    private readonly geminiService: GeminiService,
    private readonly pixelmatchService: PixelmatchService,
    private readonly diffWorkerPool: DiffWorkerPool
  ) {}

  parseConfig(configJson: string): VlmConfig {
    return parseConfig(configJson, DEFAULT_CONFIG, this.logger);
  }

  async getDiff(data: ImageCompareInput, config: VlmConfig): Promise<DiffResult> {
    const pixelmatchResult = await this.pixelmatchService.getDiff(data, PIXELMATCH_DEFAULT_CONFIG);

    if (
      !data.saveDiffAsFile ||
      !pixelmatchResult.status ||
      pixelmatchResult.status === TestStatus.new ||
      pixelmatchResult.status === TestStatus.ok
    ) {
      return pixelmatchResult;
    }

    this.logger.debug('Pixel diff is being sent to VLM');
    try {
      const [baselineBuffer, imageBuffer, diffBuffer] = await Promise.all([
        this.staticService.getImageBuffer(data.baseline),
        data.imageBuffer ?? this.staticService.getImageBuffer(data.image),
        pixelmatchResult.diffName ? this.staticService.getImageBuffer(pixelmatchResult.diffName) : null,
      ]);
      if (!baselineBuffer || !imageBuffer || !diffBuffer) {
        this.logger.warn('Missing images for VLM analysis, returning pixelmatch result');
        return pixelmatchResult;
      }

      const { baseline, image } = await this.diffWorkerPool.run({
        kind: 'vlm-inputs',
        baseline: baselineBuffer,
        image: imageBuffer,
        ignoreAreas: data.ignoreAreas,
      });
      if (!baseline || !image) {
        this.logger.warn('Missing images for VLM analysis, returning pixelmatch result');
        return pixelmatchResult;
      }

      const { pass, description } = await this.compareImagesWithVLM(
        baseline,
        image,
        new Uint8Array(diffBuffer),
        config
      );

      return {
        ...pixelmatchResult,
        status: pass ? TestStatus.ok : TestStatus.unresolved,
        vlmDescription: description,
      };
    } catch (error) {
      // a cast, not instanceof: fetch errors come from another realm
      const { message, stack } = error as Error;
      this.logger.error(`VLM comparison failed: ${message}`, stack);
      return {
        ...pixelmatchResult,
        vlmDescription: `VLM analysis failed: ${message}`,
      };
    }
  }

  private getProvider(config: VlmConfig): VlmProvider {
    return config.provider === 'gemini' ? this.geminiService : this.ollamaService;
  }

  private extractResponseContent(config: VlmConfig, response: VlmProviderResponse): string {
    const preferred = config.useThinking ? response.thinking : response.content;
    const fallback = config.useThinking ? response.content : response.thinking;
    const content = preferred || fallback;

    if (!content) {
      throw new Error('Empty response from model');
    }

    this.logger.debug(`VLM response content: ${content}`);
    return content;
  }

  private parseVlmResponse(responseContent: string): { pass: boolean; description: string } {
    const validated = VlmComparisonResultSchema.parse(JSON.parse(responseContent));
    return {
      pass: validated.identical,
      description: validated.description || 'No description provided',
    };
  }

  private async compareImagesWithVLM(
    baselineBytes: Uint8Array,
    imageBytes: Uint8Array,
    diffBytes: Uint8Array,
    config: VlmConfig
  ): Promise<{ pass: boolean; description: string }> {
    const response = await this.limiter.run(() =>
      this.getProvider(config).generate(config, [baselineBytes, imageBytes, diffBytes])
    );
    const content = this.extractResponseContent(config, response);
    return this.parseVlmResponse(content);
  }
}
