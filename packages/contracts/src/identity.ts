import { z } from 'zod';

/**
 * The initial role set from `docs/architecture/billing-actors.md`.
 * A role name alone never grants access; it is always combined with a
 * membership scope.
 */
export const roleSchema = z.enum([
  'central_admin',
  'accountant',
  'franchise_owner',
  'store_employee',
]);

export type Role = z.infer<typeof roleSchema>;

/**
 * Account lifecycle from `advanced-login.md`:
 *   invited -> active -> suspended -> active
 *                     -> disabled
 *                     -> locked -> active
 */
export const accountStateSchema = z.enum([
  'invited',
  'active',
  'suspended',
  'locked',
  'disabled',
]);

export type AccountState = z.infer<typeof accountStateSchema>;

/**
 * A resource scope. `organizationId` is always present. The remaining fields
 * narrow the scope. A membership scope "contains" a requested scope when every
 * field present on the membership equals the corresponding field on the request.
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
  userId: z.uuid(),
  role: roleSchema,
  scope: scopeSchema,
  status: z.enum(['active', 'suspended', 'revoked']),
});

export type Membership = z.infer<typeof membershipSchema>;

/**
 * Everything an authorization decision needs, all derived on the server from a
 * validated session row. Never assembled from a request body.
 */
export const actorContextSchema = z.object({
  userId: z.uuid(),
  accountState: accountStateSchema,
  sessionId: z.uuid(),
  sessionActive: z.boolean(),
  membership: membershipSchema,
  terminalId: z.uuid().optional(),
  outletId: z.uuid().optional(),
  shiftId: z.uuid().optional(),
  /** Seconds since the actor last completed an MFA / step-up challenge. */
  secondsSinceStepUp: z.number().int().nonnegative().optional(),
});

export type ActorContext = z.infer<typeof actorContextSchema>;

/** One selectable workspace shown after admin authentication. */
export const workspaceCardSchema = z.object({
  membershipId: z.uuid(),
  role: roleSchema,
  organizationId: z.uuid(),
  organizationName: z.string(),
  brandName: z.string().optional(),
  franchiseId: z.uuid().optional(),
  franchiseName: z.string().optional(),
  outletId: z.uuid().optional(),
  outletName: z.string().optional(),
  outletAddress: z.string().optional(),
});

export type WorkspaceCard = z.infer<typeof workspaceCardSchema>;
