import { BlurAmplitudeConfig } from '../blur-amplitude.config';

interface BaseVlmConfig extends BlurAmplitudeConfig {
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
