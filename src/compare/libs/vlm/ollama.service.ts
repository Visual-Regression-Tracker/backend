import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OllamaGenerateRequest,
  OllamaGenerateResponse,
  OllamaModel,
  OllamaModelsResponse,
} from './ollama.types';

@Injectable()
export class OllamaService {
  private readonly logger: Logger = new Logger(OllamaService.name);
  private baseUrl: string | null = null;

  constructor(private readonly configService: ConfigService) {}

  private getBaseUrl(): string {
    if (!this.baseUrl) {
      this.baseUrl = this.configService.getOrThrow<string>('OLLAMA_BASE_URL');
    }
    return this.baseUrl;
  }

  async generate(request: OllamaGenerateRequest): Promise<OllamaGenerateResponse> {
    const baseUrl = this.getBaseUrl();
    try {
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, stream: request.stream ?? false }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API returned status ${response.status}: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      this.logger.error(`Ollama generate request failed: ${error.message}`);
      throw error;
    }
  }

  async listModels(): Promise<OllamaModel[]> {
    const baseUrl = this.getBaseUrl();
    try {
      const response = await fetch(`${baseUrl}/api/tags`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to list models: ${response.status} ${errorText}`);
      }

      const data: OllamaModelsResponse = await response.json();
      return data.models;
    } catch (error) {
      this.logger.error(`Failed to list models: ${error.message}`);
      throw error;
    }
  }
}

