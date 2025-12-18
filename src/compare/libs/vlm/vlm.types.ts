export interface VlmConfig {
  /**
   * Ollama vision model to use for image comparison.
   * @default "gemma3:12b"
   */
  model: string;

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
