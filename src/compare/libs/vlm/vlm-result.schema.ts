import z from 'zod/v3';

export const VlmComparisonResultSchema = z.object({
  identical: z.boolean(),
  description: z.string(),
});
