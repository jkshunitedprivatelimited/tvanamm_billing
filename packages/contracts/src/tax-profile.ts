import { z } from 'zod';
import { gstRateSchema } from './catalog';

export const createTaxProfileCommandSchema = z.object({
  brandId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  hsnCode: z.string().trim().min(1).max(20),
  gstRate: gstRateSchema,
});
export type CreateTaxProfileCommand = z.infer<typeof createTaxProfileCommandSchema>;

export const updateTaxProfileCommandSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  hsnCode: z.string().trim().min(1).max(20).optional(),
  gstRate: gstRateSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateTaxProfileCommand = z.infer<typeof updateTaxProfileCommandSchema>;

export const taxProfileSchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  name: z.string(),
  hsnCode: z.string(),
  gstRate: gstRateSchema,
  isActive: z.boolean(),
});
export type TaxProfile = z.infer<typeof taxProfileSchema>;
