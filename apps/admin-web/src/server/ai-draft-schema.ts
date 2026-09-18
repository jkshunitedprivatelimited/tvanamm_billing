import { z } from 'zod';
const text = z.string().trim().min(1).max(2000);
export const aiDraftSchema = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.enum(['menu_item', 'addon', 'intermediate']),
  serving: z.string().max(200).nullable(),
  batchYield: z.string().max(200).nullable(),
  ingredients: z
    .array(
      z.object({
        name: text,
        quantity: z.string().max(100).nullable(),
        unit: z.string().max(40).nullable(),
        basis: z.enum(['per_serving', 'per_batch', 'unconfirmed']),
      }),
    )
    .max(60),
  steps: z.array(text).max(40),
  checks: z.array(text).max(30),
  missingMeasurements: z.array(text).max(40),
});
export type AiDraft = z.infer<typeof aiDraftSchema>;
export function parseAiDraft(raw: string): AiDraft {
  return aiDraftSchema.parse(
    JSON.parse(raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')),
  );
}
