import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ollama, ChatRequest, ChatResponse, ListResponse, ModelResponse } from 'ollama';

@Injectable()
export class OllamaService {
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

  async generate(request: ChatRequest): Promise<ChatResponse> {
    const client = this.getOllamaClient();

    try {
      const response = await client.chat({
        ...request,
        stream: false,
      });

      return response;
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
