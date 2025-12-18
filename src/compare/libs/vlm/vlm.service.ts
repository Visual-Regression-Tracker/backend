import { Injectable, Logger } from '@nestjs/common';
import { TestStatus } from '@prisma/client';
import { StaticService } from '../../../static/static.service';
import { DiffResult } from '../../../test-runs/diffResult';
import { parseConfig } from '../../utils';
import { NO_BASELINE_RESULT } from '../consts';
import { ImageComparator } from '../image-comparator.interface';
import { ImageCompareInput } from '../ImageCompareInput';
import { VlmConfig } from './vlm.types';
import { OllamaService } from './ollama.service';
import { VlmComparisonResult } from './ollama.types';
import { PNG } from 'pngjs';

export const SYSTEM_PROMPT = `Compare two UI screenshots for visual regression testing.

CRITICAL: Your primary goal is to detect ANY differences that would be immediately noticeable to a human eye when viewing these screenshots side-by-side.

MANDATORY CHECKS - You MUST examine and report differences in:
   - Does one screenshot show data/content differently?
   - Text content
   - Missing, added, or moved UI components

IGNORE ONLY: Minor rendering artifacts imperceptible to human eye (anti-aliasing, subtle shadows, 1-2px shifts that don't affect content visibility or functionality).`;

// Internal constant - not exposed to user config to ensure consistent JSON output
const JSON_FORMAT_INSTRUCTION = `CRITICAL: You must respond with ONLY valid JSON in this exact format:
{"identical": Boolean, "description": String}

**JSON Schema Reference:**
The JSON object MUST conform to the following schema:
{
  "identical": <boolean>,
  "description": <string>
}

**Requirements:**
1.  **"identical":** Must be a standard boolean (\`true\` or \`false\`).
2.  **"description":** Must be a detailed string explaining the reasoning.
    * If identical is \`true\`, the description should be "Screenshots are functionally identical based on all comparison criteria."
    * If identical is \`false\`, the description must clearly and concisely list the differences found (e.g., "The user count changed from 12 to 15, and the 'New User' button is missing."). Escape any internal double quotes with \\".`;

export const DEFAULT_CONFIG: VlmConfig = {
  model: 'llava:7b',
  prompt: SYSTEM_PROMPT,
  temperature: 0.1,
  useThinking: false,
};

@Injectable()
export class VlmService implements ImageComparator {
  private readonly logger: Logger = new Logger(VlmService.name);

  constructor(
    private readonly staticService: StaticService,
    private readonly ollamaService: OllamaService
  ) {}

  parseConfig(configJson: string): VlmConfig {
    return parseConfig(configJson, DEFAULT_CONFIG, this.logger);
  }

  async getDiff(data: ImageCompareInput, config: VlmConfig): Promise<DiffResult> {
    const result: DiffResult = {
      ...NO_BASELINE_RESULT,
    };

    const baseline = await this.staticService.getImage(data.baseline);
    const image = await this.staticService.getImage(data.image);

    if (!baseline || !image) {
      return NO_BASELINE_RESULT;
    }

    result.isSameDimension = baseline.width === image.width && baseline.height === image.height;

    try {
      const baselineBytes = new Uint8Array(PNG.sync.write(baseline));
      const imageBytes = new Uint8Array(PNG.sync.write(image));
      const { pass, description } = await this.compareImagesWithVLM(baselineBytes, imageBytes, config);
      result.vlmDescription = description;

      if (pass) {
        result.status = TestStatus.ok;
        result.pixelMisMatchCount = 0;
        result.diffPercent = 0;
        result.diffName = null;
      } else {
        result.status = TestStatus.unresolved;
        result.pixelMisMatchCount = 0;
        result.diffPercent = 0;
        result.diffName = null;
      }
    } catch (error) {
      this.logger.error(`VLM comparison failed: ${error.message}`, error.stack);
      result.status = TestStatus.unresolved;
      result.pixelMisMatchCount = 0;
      result.diffPercent = 0;
      result.diffName = null;
      result.vlmDescription = `VLM analysis failed: ${error.message}`;
    }

    return result;
  }

  private async compareImagesWithVLM(
    baselineBytes: Uint8Array,
    imageBytes: Uint8Array,
    config: VlmConfig
  ): Promise<{ pass: boolean; description: string }> {
    const data = await this.ollamaService.generate({
      model: config.model,
      messages: [
        {
          role: 'user',
          content: `${config.prompt}\n${JSON_FORMAT_INSTRUCTION}`,
          images: [baselineBytes, imageBytes],
        },
      ],
      format: 'json',
      options: {
        temperature: config.temperature,
      },
    });

    // Some models return result in thinking field instead of response
    const preferred = config.useThinking ? data.message.thinking : data.message.content;
    const fallback = config.useThinking ? data.message.content : data.message.thinking;
    const content = preferred || fallback;
    this.logger.debug(`VLM Response: ${content}`);

    if (!content) {
      throw new Error('Empty response from model');
    }

    return this.parseVlmResponse(content);
  }

  private parseVlmResponse(response: string): { pass: boolean; description: string } {
    const parsed = JSON.parse(response) as VlmComparisonResult;

    if (typeof parsed.identical !== 'boolean') {
      throw new TypeError('Missing or invalid "identical" field');
    }

    return {
      pass: parsed.identical,
      description: parsed.description || 'No description provided',
    };
  }
}
