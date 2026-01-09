import { VlmConfig } from './vlm.types';

/**
 * Interface for VLM (Vision Language Model) providers.
 * This abstraction allows easy addition of future providers (OpenAI, Anthropic, etc.)
 * without modifying VlmService logic.
 * Each provider is responsible for converting its own config format to internal API calls.
 */
export interface VlmProvider {
  /**
   * Generate a response from the VLM provider.
   * @param config - Provider-specific configuration
   * @param images - Array of images as Uint8Array (provider implementations handle format conversion)
   * @returns Response containing content and optional thinking field
   */
  generate(config: VlmConfig, images: Uint8Array[]): Promise<VlmProviderResponse>;
}

export interface VlmProviderResponse {
  /**
   * Main response content from the model
   */
  content?: string;

  /**
   * Optional thinking/reasoning field (some models use this instead of content)
   */
  thinking?: string;
}
