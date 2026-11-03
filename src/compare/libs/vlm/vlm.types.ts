import { RenderingNoiseConfig } from '../rendering-noise.config';

interface BaseVlmConfig extends RenderingNoiseConfig {
  model: string;
  prompt: string;
  temperature: number;
  useThinking?: boolean;
}

export interface OllamaVlmConfig extends BaseVlmConfig {
  provider?: 'ollama';
}

export interface GeminiVlmConfig extends BaseVlmConfig {
  provider: 'gemini';
  apiKey: string;
}

export type VlmConfig = OllamaVlmConfig | GeminiVlmConfig;
