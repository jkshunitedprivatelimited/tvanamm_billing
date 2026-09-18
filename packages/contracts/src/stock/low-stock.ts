import { z } from 'zod';

export const lowStockEventSchema = z.object({
  episodeId: z.uuid(),
  organizationId: z.uuid(),
  franchiseId: z.uuid().nullable(),
  outletId: z.uuid(),
  itemId: z.uuid(),
  itemName: z.string().min(1).max(160),
  baseUnit: z.string().min(1).max(20),
  quantity: z.string(),
  threshold: z.string(),
  state: z.enum(['low', 'resolved']),
});
export type LowStockEvent = z.infer<typeof lowStockEventSchema>;

export const saveLowStockRuleSchema = z.object({
  itemId: z.uuid(),
  quantity: z
    .string()
    .regex(/^\d{1,10}(\.\d{1,6})?$/, 'Enter a non-negative quantity with up to 6 decimal places.'),
  unit: z.string().min(1).max(20),
  enabled: z.boolean(),
});
