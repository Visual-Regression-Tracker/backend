import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ollama, ChatRequest, ChatResponse, ListResponse, ModelResponse } from 'ollama';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { VlmProvider, VlmProviderResponse } from '../../vlm-provider.interface';
import { VlmConfig, OllamaVlmConfig } from '../../vlm.types';
import { VlmComparisonResultSchema } from '../../vlm.service';

@Injectable()
export class OllamaService implements VlmProvider {
  private readonly logger: Logger = new Logger(OllamaService.name);
  private ollamaClient: Ollama | null = null;

  constructor(private readonly configService: ConfigService) {}

  private getOllamaClient(): Ollama {
    if (!this.ollamaClient) {
      const baseUrl = this.configService.getOrThrow<string>('OLLAMA_BASE_URL');
      this.ollamaClient = new Ollama({ host: baseUrl });
    }
    return this.ollamaClient;
  }

  async generate(config: VlmConfig, images: Uint8Array[]): Promise<VlmProviderResponse> {
    // Type guard: ensure this is Ollama config
    if (config.provider && config.provider !== 'ollama') {
      throw new Error(`OllamaService requires OllamaVlmConfig, got ${config.provider}`);
    }

    const ollamaConfig = config as OllamaVlmConfig;
    const client = this.getOllamaClient();

    try {
      const format = zodToJsonSchema(VlmComparisonResultSchema);

      const chatRequest: ChatRequest = {
        model: ollamaConfig.model,
        messages: [
          {
            role: 'user',
            content: ollamaConfig.prompt,
            images,
          },
        ],
        stream: false,
        format,
        options: {
          temperature: ollamaConfig.temperature,
        },
      };

      const response: ChatResponse = await client.chat({
        ...chatRequest,
        stream: false,
      });

      return {
        content: response.message.content,
        thinking: response.message.thinking,
      };
    } catch (error) {
      this.logger.error(`Ollama generate request failed: ${error.message}`);
      throw error;
    }
  }

  async listModels(): Promise<ModelResponse[]> {
    const client = this.getOllamaClient();
    try {
      const response: ListResponse = await client.list();
      return response.models;
    } catch (error) {
      this.logger.error(`Failed to list models: ${error.message}`);
      throw error;
    }
  }
}
