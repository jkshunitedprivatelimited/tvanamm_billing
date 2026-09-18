import { z } from 'zod';
const positiveQuantity = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,6})?$/)
  .refine((v) => Number(v) > 0, 'Quantity must be greater than zero');
export const publishRecipeVersionSchema = z
  .object({
    servingQtyBase: positiveQuantity,
    servingUnit: z.enum(['g', 'ml', 'each']),
    batchYieldBase: positiveQuantity.nullish(),
    preparedBaseItemId: z.uuid().nullish(),
    preparedBaseQtyBase: positiveQuantity.nullish(),
    yieldUnverified: z.boolean().optional(),
    components: z
      .array(
        z.object({
          componentType: z.enum(['fixed', 'optional', 'alternative', 'addon', 'packaging']),
          itemId: z.uuid(),
          qtyBase: positiveQuantity,
          alternativeGroup: z.string().trim().max(60).nullish(),
          isDefault: z.boolean().optional(),
          processLossPct: z.number().min(0).max(99).optional(),
        }),
      )
      .min(1)
      .max(200),
  })
  .superRefine((value, ctx) => {
    if (value.batchYieldBase && Number(value.servingQtyBase) > Number(value.batchYieldBase))
      ctx.addIssue({
        code: 'custom',
        message: 'Serving quantity exceeds usable batch yield',
        path: ['servingQtyBase'],
      });
    if (!!value.preparedBaseItemId !== !!value.preparedBaseQtyBase)
      ctx.addIssue({
        code: 'custom',
        message: 'Prepared base needs both an item and quantity',
        path: ['preparedBaseItemId'],
      });
    const alternatives = value.components.filter((c) => c.componentType === 'alternative');
    for (const c of alternatives)
      if (!c.alternativeGroup)
        ctx.addIssue({
          code: 'custom',
          message: 'Alternative ingredients need a named group',
          path: ['components'],
        });
    for (const group of new Set(alternatives.map((c) => c.alternativeGroup))) {
      if (
        alternatives.filter((c) => c.alternativeGroup === group && c.isDefault !== false).length !==
        1
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Each alternative group needs exactly one default ingredient',
          path: ['components'],
        });
    }
  });
