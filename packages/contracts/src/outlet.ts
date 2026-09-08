import { z } from 'zod';
import { mobileNumberSchema } from './identity';

export const outletOwnershipSchema = z.enum(['jksh_owned', 'franchise_owned']);
export type OutletOwnership = z.infer<typeof outletOwnershipSchema>;

export const outletStatusSchema = z.enum(['draft', 'active', 'suspended', 'closed']);
export type OutletStatus = z.infer<typeof outletStatusSchema>;

/** Central Admin creates an outlet. GSTIN is optional and never blocks activation. */
export const createOutletCommandSchema = z
  .object({
    brandId: z.uuid(),
    ownershipType: outletOwnershipSchema,
    franchiseId: z.uuid().optional(),
    displayName: z.string().trim().min(2).max(120),
    legalName: z.string().trim().max(160).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9\s-]{7,17}$/)
      .optional(),
    gstin: z
      .string()
      .trim()
      .regex(/^[0-9A-Z]{15}$/)
      .optional(),
    addressLine: z.string().trim().max(240).default(''),
    city: z.string().trim().max(80).default(''),
    state: z.string().trim().max(80).default(''),
    postalCode: z.string().trim().max(16).default(''),
    nearestBusStop: z.string().trim().max(200).optional(),
    /** GST-inclusive delivery charge JKSH adds when supplying this branch. */
    transportChargePaise: z.int().nonnegative().max(100_000_00).optional(),
    country: z.string().trim().length(2).default('IN'),
    timezone: z.string().min(3).max(64).default('Asia/Kolkata'),
    paymentMethods: z
      .array(z.enum(['cash', 'upi']))
      .min(1)
      .default(['cash', 'upi']),
  })
  .refine(
    (v) =>
      (v.ownershipType === 'franchise_owned' && !!v.franchiseId) ||
      (v.ownershipType === 'jksh_owned' && !v.franchiseId),
    {
      message: 'franchiseId is required for franchise_owned and forbidden for jksh_owned',
      path: ['franchiseId'],
    },
  );
export type CreateOutletCommand = z.infer<typeof createOutletCommandSchema>;

export const outletLifecycleActionSchema = z.enum(['activate', 'suspend', 'close', 'reactivate']);
export type OutletLifecycleAction = z.infer<typeof outletLifecycleActionSchema>;

export const outletLifecycleCommandSchema = z.object({
  action: outletLifecycleActionSchema,
  reason: z.string().trim().min(1).max(300).optional(),
});
export type OutletLifecycleCommand = z.infer<typeof outletLifecycleCommandSchema>;

/** Fields a Franchise Owner (or Central) may adjust after creation. */
export const updateOutletConfigCommandSchema = z.object({
  displayName: z.string().trim().min(2).max(120).optional(),
  legalName: z.string().trim().max(160).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9\s-]{7,17}$/)
    .optional(),
  gstin: z
    .string()
    .trim()
    .regex(/^[0-9A-Z]{15}$/)
    .optional(),
  addressLine: z.string().trim().max(240).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(16).optional(),
  receiptConfig: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateOutletConfigCommand = z.infer<typeof updateOutletConfigCommandSchema>;

export const outletSummarySchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  ownershipType: outletOwnershipSchema,
  status: outletStatusSchema,
  brandId: z.uuid(),
  brandName: z.string(),
  franchiseId: z.uuid().optional(),
  franchiseName: z.string().optional(),
  city: z.string(),
  gstin: z.string().optional(),
  billingEnabled: z.boolean(),
  hasActiveTerminal: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type OutletSummary = z.infer<typeof outletSummarySchema>;

// Re-export so callers can validate an owner's mobile against the shared rule.
export { mobileNumberSchema };
