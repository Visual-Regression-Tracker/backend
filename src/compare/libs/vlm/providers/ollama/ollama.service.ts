import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ollama, ModelResponse } from 'ollama';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { VlmProvider, VlmProviderResponse } from '../../vlm-provider.interface';
import { VlmConfig } from '../../vlm.types';
import { VlmComparisonResultSchema } from '../../vlm-result.schema';

const TIMEOUT_MS = 300_000;

@Injectable()
export class OllamaService implements VlmProvider {
  private readonly logger: Logger = new Logger(OllamaService.name);
  private ollamaClient: Ollama | null = null;

  constructor(private readonly configService: ConfigService) {}

  private getOllamaClient(): Ollama {
    if (!this.ollamaClient) {
      const baseUrl = this.configService.getOrThrow<string>('OLLAMA_BASE_URL');
      this.ollamaClient = new Ollama({
        host: baseUrl,
        // non-streaming chat sends headers only when done: without this a stalled model holds the upload for good
        fetch: (url, init) =>
          fetch(url, {
            ...init,
            signal: init?.signal
              ? AbortSignal.any([init.signal, AbortSignal.timeout(TIMEOUT_MS)])
              : AbortSignal.timeout(TIMEOUT_MS),
          }),
      });
    }
    return this.ollamaClient;
  }

  async generate(config: VlmConfig, images: Uint8Array[]): Promise<VlmProviderResponse> {
    if (config.provider && config.provider !== 'ollama') {
      throw new Error(`OllamaService requires OllamaVlmConfig, got ${config.provider}`);
    }
    const client = this.getOllamaClient();

    try {
      const response = await client.chat({
        model: config.model,
        messages: [{ role: 'user', content: config.prompt, images }],
        stream: false,
        format: zodToJsonSchema(VlmComparisonResultSchema),
        options: { temperature: config.temperature },
      });
      return {
        content: response.message.content,
        thinking: response.message.thinking,
      };
    } catch (error) {
      this.logger.error(`Ollama generate request failed: ${(error as Error).message}`);
      throw error;
    }
  }

  async listModels(): Promise<ModelResponse[]> {
    const client = this.getOllamaClient();
    try {
      return (await client.list()).models;
    } catch (error) {
      this.logger.error(`Failed to list models: ${(error as Error).message}`);
      throw error;
    }
  }
}
