import { VlmConfig } from './vlm.types';

export interface VlmProvider {
  generate(config: VlmConfig, images: Uint8Array[]): Promise<VlmProviderResponse>;
}

export interface VlmProviderResponse {
  content?: string;
  thinking?: string;
}
