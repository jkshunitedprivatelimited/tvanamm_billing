import { z } from 'zod';

export const createFranchiseCommandSchema = z.object({
  brandId: z.uuid(),
  name: z.string().trim().min(2).max(120),
});
export type CreateFranchiseCommand = z.infer<typeof createFranchiseCommandSchema>;

export const franchiseSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  brandId: z.uuid(),
  brandName: z.string(),
  status: z.enum(['active', 'suspended', 'closed']),
  outletCount: z.number().int().nonnegative(),
});
export type FranchiseSummary = z.infer<typeof franchiseSummarySchema>;
