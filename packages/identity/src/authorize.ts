import {
  ROLE_CAPABILITIES,
  type AccessScope,
  type ActorContext,
  type Capability,
} from '@jksh/contracts';

/**
 * A membership scope "contains" a requested scope when every field the
 * membership pins down matches the request. Brand is only checked when the
 * request names one (a franchise already belongs to exactly one brand).
 */
export function scopeContains(membership: AccessScope, requested: AccessScope): boolean {
  if (membership.organizationId !== requested.organizationId) return false;
  if (membership.brandId && requested.brandId && membership.brandId !== requested.brandId) {
    return false;
  }
  if (membership.franchiseId && membership.franchiseId !== requested.franchiseId) return false;
  if (membership.outletId && membership.outletId !== requested.outletId) return false;
  return true;
}

/**
 * Sensitive owner/internal actions require a session that completed a strong
 * challenge (mobile OTP) within this window (`advanced-login.md` "Fresh
 * Authentication for Sensitive Administration").
 */
export const FRESH_AUTH_SECONDS = 15 * 60;

export interface PolicyContext {
  requireFreshAuthWithinSeconds?: number;
  requireOpenShift?: boolean;
  requireTerminalOutlet?: string;
  now?: Date;
}

export type AuthzDecision = { allowed: true } | { allowed: false; reason: AuthzDenyReason };

export type AuthzDenyReason =
  | 'session_inactive'
  | 'account_inactive'
  | 'out_of_scope'
  | 'capability_not_granted'
  | 'fresh_auth_required'
  | 'shift_required'
  | 'terminal_context_required';

/**
 * The single authorization gate (`advanced-login.md` "Authorization"). Allows
 * only when every clause passes. Never branches on a role name outside
 * `ROLE_CAPABILITIES`.
 */
export function authorize(
  actor: ActorContext,
  capability: Capability,
  requested: AccessScope,
  policy: PolicyContext = {},
): AuthzDecision {
  if (!actor.sessionActive) return { allowed: false, reason: 'session_inactive' };
  if (actor.kind === 'admin' && actor.accountStatus !== 'active') {
    return { allowed: false, reason: 'account_inactive' };
  }
  if (!scopeContains(actor.scope, requested)) {
    return { allowed: false, reason: 'out_of_scope' };
  }
  if (!ROLE_CAPABILITIES[actor.role].includes(capability)) {
    return { allowed: false, reason: 'capability_not_granted' };
  }

  if (policy.requireFreshAuthWithinSeconds !== undefined) {
    const since = actor.secondsSinceAuth;
    if (since === undefined || since > policy.requireFreshAuthWithinSeconds) {
      return { allowed: false, reason: 'fresh_auth_required' };
    }
  }
  if (policy.requireOpenShift && !actor.shiftId) {
    return { allowed: false, reason: 'shift_required' };
  }
  if (policy.requireTerminalOutlet !== undefined) {
    if (!actor.terminalId || actor.outletId !== policy.requireTerminalOutlet) {
      return { allowed: false, reason: 'terminal_context_required' };
    }
  }
  return { allowed: true };
}

export function grantedCapabilities(actor: ActorContext): readonly Capability[] {
  return ROLE_CAPABILITIES[actor.role];
}
