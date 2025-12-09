export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  images?: string[];
  stream?: boolean;
  format?: 'json';
  options?: {
    temperature?: number;
    top_k?: number;
    top_p?: number;
  };
}

export interface VlmComparisonResult {
  identical: boolean;
  description: string;
}

export interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  thinking?: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
}

export interface OllamaModel {
  name: string;
  size?: number;
  digest?: string;
  modified_at?: string;
}

export interface OllamaModelsResponse {
  models: OllamaModel[];
}
