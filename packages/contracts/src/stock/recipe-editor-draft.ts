import { z } from 'zod';

const quantity = z.string().max(30);
export const recipeEditorDraftSchema = z
  .object({
    basis: z.enum(['serving', 'batch']),
    serving: quantity,
    unit: z.enum(['g', 'ml', 'each']),
    yieldQty: quantity,
    lines: z
      .array(
        z
          .object({
            key: z.int().nonnegative(),
            itemId: z.union([z.uuid(), z.literal('')]),
            quantity,
            kind: z.enum(['fixed', 'packaging', 'optional', 'alternative', 'addon']),
            group: z.string().max(60),
            isDefault: z.boolean(),
            sourceName: z.string().max(160).optional(),
            sourceUnit: z.string().max(30).optional(),
            sourceQuantity: quantity.optional(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type RecipeEditorDraft = z.infer<typeof recipeEditorDraftSchema>;
