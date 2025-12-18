import { Injectable, Logger } from '@nestjs/common';
import { TestStatus } from '@prisma/client';
import { StaticService } from '../../../static/static.service';
import { DiffResult } from '../../../test-runs/diffResult';
import { parseConfig } from '../../utils';
import { ImageComparator } from '../image-comparator.interface';
import { ImageCompareInput } from '../ImageCompareInput';
import { VlmConfig } from './vlm.types';
import { OllamaService } from './ollama.service';
import { PixelmatchService, DEFAULT_CONFIG as PIXELMATCH_DEFAULT_CONFIG } from '../pixelmatch/pixelmatch.service';
import { PNG } from 'pngjs';
import { z } from 'zod';

export const DEFAULT_PROMPT = `You are provided with three images:
1. First image: baseline screenshot
2. Second image: new version screenshot
3. Diff image

Spot any difference in text, color, shape and position of elements - treat as different even slight change.
Ignore minor rendering artifacts that are imperceptible to users like antialiasing.
Describe the difference in about 100 words.`;

const VlmComparisonResultSchema: z.ZodObject<{
  identical: z.ZodBoolean;
  description: z.ZodString;
}> = z.object({
  identical: z.boolean(),
  description: z.string(),
});

export const DEFAULT_CONFIG: VlmConfig = {
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

  private async compareImagesWithVLM(
    baselineBytes: Uint8Array,
    imageBytes: Uint8Array,
    diffBytes: Uint8Array,
    config: VlmConfig
  ): Promise<{ pass: boolean; description: string }> {
    const data = await this.ollamaService.generate({
      model: config.model,
      messages: [
        {
          role: 'user',
          content: config.prompt,
          images: [baselineBytes, imageBytes, diffBytes],
        },
      ],
      format: z.toJSONSchema(VlmComparisonResultSchema),
      options: {
        temperature: config.temperature,
      },
    });

    // Some models return result in thinking field instead of content field
    const preferred = config.useThinking ? data.message.thinking : data.message.content;
    const fallback = config.useThinking ? data.message.content : data.message.thinking;
    const content = preferred || fallback;

    this.logger.debug(`VLM response content: ${content}`);

    if (!content) {
      throw new Error('Empty response from model');
    }

    return this.parseVlmResponse(content);
  }

  private parseVlmResponse(response: string): { pass: boolean; description: string } {
    const parsed = JSON.parse(response);
    const validated = VlmComparisonResultSchema.parse(parsed);

    return {
      pass: validated.identical,
      description: validated.description || 'No description provided',
    };
  }
}
