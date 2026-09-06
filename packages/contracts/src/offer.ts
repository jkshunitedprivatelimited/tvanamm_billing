import { z } from 'zod';
import { moneySchema } from './billing';

export const offerDiscountKindSchema = z.enum(['fixed', 'percent']);
export const offerStateSchema = z.enum(['draft', 'active', 'paused', 'expired']);
export const offerTargetTypeSchema = z.enum(['item', 'combo']);

export const offerTargetInputSchema = z.object({
  targetType: offerTargetTypeSchema,
  targetId: z.uuid(),
});

export const createOfferCommandSchema = z
  .object({
    brandId: z.uuid(),
    originOutletId: z.uuid().optional(), // present => franchise-owned offer
    name: z.string().trim().min(1).max(160),
    label: z.string().trim().min(1).max(80),
    discountKind: offerDiscountKindSchema,
    discountValue: moneySchema,
    priority: z.int().min(0).max(10000).default(100),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    daysOfWeek: z.array(z.int().min(0).max(6)).max(7).optional(),
    startTime: z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/)
      .optional(),
    endTime: z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/)
      .optional(),
    targets: z.array(offerTargetInputSchema).min(1).max(200),
    outletIds: z.array(z.uuid()).min(1).max(500),
  })
  .refine((v) => v.endsOn >= v.startsOn, { message: 'endsOn must be on or after startsOn' })
  .refine((v) => (v.startTime === undefined) === (v.endTime === undefined), {
    message: 'startTime and endTime must be set together',
  })
  .refine((v) => v.discountKind !== 'percent' || Number(v.discountValue) <= 100, {
    message: 'a percent offer cannot exceed 100',
  });
export type CreateOfferCommand = z.infer<typeof createOfferCommandSchema>;

export const offerLifecycleCommandSchema = z.object({
  action: z.enum(['publish', 'pause', 'resume']),
});
export type OfferLifecycleCommand = z.infer<typeof offerLifecycleCommandSchema>;

export const offerViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  label: z.string(),
  discountKind: offerDiscountKindSchema,
  discountValue: moneySchema,
  priority: z.int(),
  state: offerStateSchema,
  startsOn: z.string(),
  endsOn: z.string(),
  daysOfWeek: z.array(z.int()).nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  version: z.int(),
  targets: z.array(offerTargetInputSchema),
  outletIds: z.array(z.uuid()),
});
export type OfferView = z.infer<typeof offerViewSchema>;
