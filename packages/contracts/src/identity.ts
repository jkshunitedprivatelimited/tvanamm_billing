import { z } from 'zod';

/**
 * Assignable membership roles (`docs/plans/billing-data-api-plan.md` §3).
 * `store_employee` is NOT a membership role — Store Employees authenticate
 * through the operator-session path and get a fixed capability set.
 */
export const membershipRoleSchema = z.enum(['central_admin', 'accountant', 'franchise_owner']);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

/** All actor roles, including the operator-only `store_employee`. */
export const roleSchema = z.enum([
  'central_admin',
  'accountant',
  'franchise_owner',
  'store_employee',
]);
export type Role = z.infer<typeof roleSchema>;

export const accountStatusSchema = z.enum(['invited', 'active', 'suspended', 'locked', 'closed']);
export type AccountStatus = z.infer<typeof accountStatusSchema>;

export const employeeStatusSchema = z.enum(['active', 'suspended', 'disabled']);
export type EmployeeStatus = z.infer<typeof employeeStatusSchema>;

/** E.164 mobile number, e.g. +919876543210. */
export const mobileNumberSchema = z.string().regex(/^\+[1-9]\d{7,14}$/);

/**
 * A resource scope. `organizationId` is always present; the remaining fields
 * narrow it. A membership scope "contains" a request when every field the
 * membership pins down matches the request.
 */
export const scopeSchema = z.object({
  organizationId: z.uuid(),
  brandId: z.uuid().optional(),
  franchiseId: z.uuid().optional(),
  outletId: z.uuid().optional(),
});
export type AccessScope = z.infer<typeof scopeSchema>;

export const membershipSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  role: membershipRoleSchema,
  scope: scopeSchema,
  status: z.enum(['active', 'suspended', 'revoked']),
});
export type Membership = z.infer<typeof membershipSchema>;

/**
 * Everything an authorization decision needs, derived on the server from the
 * validated Supabase session + selected workspace (admin) or operator session
 * (store). Never assembled from a request body.
 */
export const actorContextSchema = z.object({
  kind: z.enum(['admin', 'operator']),
  accountId: z.uuid().optional(),
  employeeId: z.uuid().optional(),
  accountStatus: accountStatusSchema.optional(),
  role: roleSchema,
  scope: scopeSchema,
  sessionActive: z.boolean(),
  terminalId: z.uuid().optional(),
  outletId: z.uuid().optional(),
  shiftId: z.uuid().optional(),
  /** Seconds since the actor last completed a strong challenge (OTP / PIN). */
  secondsSinceAuth: z.number().int().nonnegative().optional(),
});
export type ActorContext = z.infer<typeof actorContextSchema>;

/** One selectable workspace shown after admin authentication. */
export const workspaceCardSchema = z.object({
  membershipId: z.uuid(),
  role: membershipRoleSchema,
  organizationId: z.uuid(),
  organizationName: z.string(),
  brandName: z.string().optional(),
  franchiseId: z.uuid().optional(),
  franchiseName: z.string().optional(),
});
export type WorkspaceCard = z.infer<typeof workspaceCardSchema>;
