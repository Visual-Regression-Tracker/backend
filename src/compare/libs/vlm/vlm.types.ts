import { BlurAmplitudeConfig } from '../blur-amplitude.config';

export interface BaseVlmConfig extends BlurAmplitudeConfig {
  prompt: string;
  temperature: number;
  useThinking?: boolean;
}

export interface OllamaVlmConfig extends BaseVlmConfig {
  provider?: 'ollama';
  model: string;
}

export interface GeminiVlmConfig extends BaseVlmConfig {
  provider: 'gemini';
  model: string;
  apiKey: string;
}

export type VlmConfig = OllamaVlmConfig | GeminiVlmConfig;
