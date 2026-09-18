import { z } from 'zod';
import { invitationPhoneSchema, mobileNumberSchema } from './identity';
export const inviteOutletOwnerSchema = z.object({
  brandId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  fullName: z.string().trim().min(2).max(120),
  phone: invitationPhoneSchema,
});
export const ownerOutletDetailsSchema = z
  .object({
    displayName: z.string().trim().min(2).max(120),
    phone: mobileNumberSchema,
    addressLine: z.string().trim().min(3).max(240),
    city: z.string().trim().min(2).max(80),
    state: z.string().trim().min(2).max(80),
    postalCode: z.string().regex(/^\d{6}$/),
    gstin: z
      .string()
      .trim()
      .regex(/^[0-9A-Z]{15}$/)
      .optional(),
    nearestBusStop: z.string().trim().max(200).optional(),
  })
  .strict();
export type OwnerOutletDetails = z.infer<typeof ownerOutletDetailsSchema>;
export interface OutletOnboardingView {
  franchiseId: string;
  name: string;
  phone: string;
  stage: 'invited' | 'details_pending' | 'ready_for_review' | 'active' | 'outlet_created';
  details: OwnerOutletDetails | null;
  outletId: string | null;
}
