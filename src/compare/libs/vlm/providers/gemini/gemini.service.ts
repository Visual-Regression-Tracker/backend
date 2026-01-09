import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { VlmProvider, VlmProviderResponse } from '../../vlm-provider.interface';
import { VlmConfig, GeminiVlmConfig } from '../../vlm.types';
import { VlmComparisonResultSchema } from '../../vlm.service';

@Injectable()
export class GeminiService implements VlmProvider {
  private readonly logger: Logger = new Logger(GeminiService.name);

  private getGenAI(apiKey: string): GoogleGenAI {
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }
    return new GoogleGenAI({ apiKey });
  }

  private imageToBase64(imageBytes: Uint8Array): string {
    const base64 = Buffer.from(imageBytes).toString('base64');
    return base64;
  }

  async generate(config: VlmConfig, images: Uint8Array[]): Promise<VlmProviderResponse> {
    // Type guard: ensure this is Gemini config
    if (config.provider !== 'gemini') {
      throw new Error(`GeminiService requires GeminiVlmConfig, got ${config.provider}`);
    }

    const geminiConfig: GeminiVlmConfig = config;

    const genAI = this.getGenAI(geminiConfig.apiKey);

    try {
      const imageParts = images.map((img) => ({
        inlineData: {
          data: this.imageToBase64(img),
          mimeType: 'image/png',
        },
      }));

      const parts = [{ text: geminiConfig.prompt }, ...imageParts];

      const result = await genAI.models.generateContent({
        model: geminiConfig.model,
        contents: parts,
        config: {
          temperature: geminiConfig.temperature,
          responseMimeType: 'application/json' as const,
          responseJsonSchema: zodToJsonSchema(VlmComparisonResultSchema),
        },
      });

      return {
        content: result.text,
      };
    } catch (error) {
      this.logger.error(`Gemini generate request failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}
