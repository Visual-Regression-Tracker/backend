/**
 * Base configuration shared by all VLM providers
 */
export interface BaseVlmConfig {
  /**
   * Custom prompt for image comparison.
   */
  prompt: string;

  /**
   * Temperature parameter controlling response randomness (0.0-1.0).
   * Lower values = more consistent results.
   * @default 0.1
   */
  temperature: number;

  /**
   * Whether to prefer thinking field over content field for response.
   * Some models return result in thinking field instead of response.
   * @default false
   */
  useThinking?: boolean;
}

/**
 * Configuration for Ollama provider
 */
export interface OllamaVlmConfig extends BaseVlmConfig {
  provider?: 'ollama';

  /**
   * Ollama vision model name.
   * Examples: "gemma3:12b", "llava:13b"
   * @default "gemma3:12b"
   */
  model: string;
}

/**
 * Configuration for Gemini provider
 */
export interface GeminiVlmConfig extends BaseVlmConfig {
  provider: 'gemini';

  /**
   * Gemini model name.
   * Examples: "gemini-1.5-pro", "gemini-1.5-flash"
   */
  model: string;

  /**
   * Google Gemini API key (required).
   * Stored in project settings for per-project configuration.
   */
  apiKey: string;
}

/**
 * Union type for all VLM provider configurations
 */
export type VlmConfig = OllamaVlmConfig | GeminiVlmConfig;
