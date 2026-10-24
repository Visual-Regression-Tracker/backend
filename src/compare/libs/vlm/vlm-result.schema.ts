import z from 'zod/v3';

// The answer a VLM provider must give. Its own module because the providers
// validate with it and VlmService uses the providers: kept in vlm.service it
// made an import cycle, which only resolves when vlm.service loads first.
export const VlmComparisonResultSchema = z.object({
  identical: z.boolean(),
  description: z.string(),
});
