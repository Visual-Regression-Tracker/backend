import { Injectable, Logger } from '@nestjs/common';
import { TestStatus } from '@prisma/client';
import { StaticService } from '../../../static/static.service';
import { DiffResult } from '../../../test-runs/diffResult';
import { parseConfig } from '../../utils';
import { ImageComparator } from '../image-comparator.interface';
import { ImageCompareInput } from '../ImageCompareInput';
import { VlmConfig, OllamaVlmConfig } from './vlm.types';
import { VlmProvider } from './vlm-provider.interface';
import { OllamaService } from './providers/ollama/ollama.service';
import { GeminiService } from './providers/gemini/gemini.service';
import { PixelmatchService, DEFAULT_CONFIG as PIXELMATCH_DEFAULT_CONFIG } from '../pixelmatch/pixelmatch.service';
import { PNG } from 'pngjs';
import z from 'zod/v3';

export const DEFAULT_PROMPT = `You are provided with three images:
1. First image: baseline screenshot
2. Second image: new version screenshot
3. Diff image

Spot any difference in text, color, shape and position of elements - treat as different even slight change.
Ignore minor rendering artifacts that are imperceptible to users like antialiasing.
Describe the difference in about 100 words.`;

export const VlmComparisonResultSchema = z.object({
  identical: z.boolean(),
  description: z.string(),
});

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

  constructor(
    private readonly staticService: StaticService,
    private readonly ollamaService: OllamaService,
    private readonly geminiService: GeminiService,
    private readonly pixelmatchService: PixelmatchService
  ) {}

  parseConfig(configJson: string): VlmConfig {
    return parseConfig(configJson, DEFAULT_CONFIG, this.logger);
  }

  async getDiff(data: ImageCompareInput, config: VlmConfig): Promise<DiffResult> {
    const pixelmatchResult = await this.pixelmatchService.getDiff(
      {
        ...data,
        saveDiffAsFile: true,
      },
      PIXELMATCH_DEFAULT_CONFIG
    );

    if (pixelmatchResult.status === TestStatus.new) {
      return pixelmatchResult;
    }

    if (pixelmatchResult.status === TestStatus.ok) {
      return pixelmatchResult;
    }

    this.logger.debug('Pixel diff is being sent to VLM');
    try {
      const baseline = await this.staticService.getImage(data.baseline);
      const image = await this.staticService.getImage(data.image);
      const diffImage = pixelmatchResult.diffName ? await this.staticService.getImage(pixelmatchResult.diffName) : null;

      if (!baseline || !image || !diffImage) {
        this.logger.warn('Missing images for VLM analysis, returning pixelmatch result');
        return pixelmatchResult;
      }

      const baselineBytes = new Uint8Array(PNG.sync.write(baseline));
      const imageBytes = new Uint8Array(PNG.sync.write(image));
      const diffBytes = new Uint8Array(PNG.sync.write(diffImage));

      const { pass, description } = await this.compareImagesWithVLM(baselineBytes, imageBytes, diffBytes, config);

      // Build result from pixelmatch, but override status based on VLM analysis
      const result: DiffResult = {
        ...pixelmatchResult,
        vlmDescription: description,
      };

      if (pass) {
        result.status = TestStatus.ok;
      } else {
        result.status = TestStatus.unresolved;
      }

      return result;
    } catch (error) {
      this.logger.error(`VLM comparison failed: ${error.message}`, error.stack);
      return {
        ...pixelmatchResult,
        vlmDescription: `VLM analysis failed: ${error.message}`,
      };
    }
  }

  private getProvider(config: VlmConfig): VlmProvider {
    const provider = config.provider || 'ollama'; // Default to ollama for backward compatibility

    switch (provider) {
      case 'gemini':
        return this.geminiService;
      case 'ollama':
      default:
        return this.ollamaService;
    }
  }

  private extractResponseContent(config: VlmConfig, response: { content?: string; thinking?: string }): string {
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
    const parsed = JSON.parse(responseContent);
    const validated = VlmComparisonResultSchema.parse(parsed);

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
    const provider = this.getProvider(config);
    const images = [baselineBytes, imageBytes, diffBytes];
    const response = await provider.generate(config, images);
    const content = this.extractResponseContent(config, response);
    return this.parseVlmResponse(content);
  }
}
