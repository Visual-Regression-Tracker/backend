import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { VlmProvider, VlmProviderResponse } from '../../vlm-provider.interface';
import { VlmConfig } from '../../vlm.types';
import { VlmComparisonResultSchema } from '../../vlm-result.schema';

const TIMEOUT_MS = 300_000;

@Injectable()
export class GeminiService implements VlmProvider {
  private readonly logger: Logger = new Logger(GeminiService.name);

  private getGenAI(apiKey: string): GoogleGenAI {
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: TIMEOUT_MS },
    });
  }

  async generate(config: VlmConfig, images: Uint8Array[]): Promise<VlmProviderResponse> {
    if (config.provider !== 'gemini') {
      throw new Error(`GeminiService requires GeminiVlmConfig, got ${config.provider}`);
    }
    const genAI = this.getGenAI(config.apiKey);

    try {
      const imageParts = images.map((img) => ({
        inlineData: { data: Buffer.from(img).toString('base64'), mimeType: 'image/png' },
      }));
      const result = await genAI.models.generateContent({
        model: config.model,
        contents: [{ text: config.prompt }, ...imageParts],
        config: {
          temperature: config.temperature,
          responseMimeType: 'application/json',
          responseJsonSchema: zodToJsonSchema(VlmComparisonResultSchema),
        },
      });
      return { content: result.text };
    } catch (error) {
      this.logger.error(`Gemini generate request failed: ${(error as Error).message}`, (error as Error).stack);
      throw error;
    }
  }
}
