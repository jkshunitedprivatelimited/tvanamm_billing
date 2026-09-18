import { z } from 'zod';
const text = z.string().trim().max(3000);
const quantity = z
  .string()
  .trim()
  .max(30)
  .refine(
    (v) => v === '' || (/^\d+(\.\d+)?$/.test(v) && Number(v) > 0 && Number(v) <= 1000000),
    'Use a positive measured quantity',
  );
export const chefDraftSchema = z
  .object({
    chefName: z.string().trim().max(120),
    basis: z.enum(['serving', 'batch']),
    servingQuantity: quantity,
    servingUnit: z.enum(['ml', 'g', 'pieces']),
    portionName: z.string().trim().max(100),
    batchYield: quantity,
    batchUnit: z.enum(['ml', 'g', 'pieces']),
    servingsPerBatch: quantity,
    ingredients: z
      .array(
        z
          .object({
            name: z.string().trim().max(160),
            quantity,
            unit: z.enum(['g', 'ml', 'pieces']),
            note: z.string().trim().max(250),
          })
          .strict(),
      )
      .max(60),
    method: text,
    packaging: text,
    measurements: text,
    variations: text,
    questions: text,
    status: z.enum(['draft', 'ready']),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.status !== 'ready') return;
    const missing =
      !d.chefName ||
      !d.servingQuantity ||
      !d.method ||
      !d.packaging ||
      !d.ingredients.length ||
      d.ingredients.some((i) => !i.name || !i.quantity) ||
      (d.basis === 'batch' && (!d.batchYield || !d.servingsPerBatch));
    if (missing)
      ctx.addIssue({
        code: 'custom',
        message:
          'Complete the chef name, serving size, ingredients, method and packaging. Batch recipes also need a finished yield and servings per batch.',
      });
    if (d.questions)
      ctx.addIssue({
        code: 'custom',
        message: 'Resolve the open questions before marking this recipe ready.',
      });
  });
export type ChefDraft = z.infer<typeof chefDraftSchema>;
export interface ChefItem {
  id: string;
  name: string;
  category: string;
}
export interface ChefEntry {
  itemId: string;
  draft: ChefDraft;
  revision: number;
}
export interface ChefCollection {
  id: string;
  title: string;
  menu: ChefItem[];
  entries: ChefEntry[];
  expiresAt: string;
  closed: boolean;
  submitted: boolean;
}
export const emptyChefDraft = (): ChefDraft => ({
  chefName: '',
  basis: 'serving',
  servingQuantity: '',
  servingUnit: 'ml',
  portionName: 'Regular',
  batchYield: '',
  batchUnit: 'ml',
  servingsPerBatch: '',
  ingredients: [{ name: '', quantity: '', unit: 'g', note: '' }],
  method: '',
  packaging: '',
  measurements: '',
  variations: '',
  questions: '',
  status: 'draft',
});
