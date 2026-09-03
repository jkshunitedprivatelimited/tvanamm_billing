import {
  ROLE_CAPABILITIES,
  type AccessScope,
  type ActorContext,
  type Capability,
} from '@jksh/contracts';

/**
 * A membership scope "contains" a requested scope when every field the
 * membership pins down matches the request, and the request is at least as
 * specific as the membership.
 *
 *   org-only membership       contains any request in that org
 *   org+franchise membership  contains requests for that franchise / its outlets
 *   org+franchise+outlet      contains only requests for that exact outlet
 */
export function scopeContains(
  membership: AccessScope,
  requested: AccessScope,
): boolean {
  if (membership.organizationId !== requested.organizationId) return false;
  // Brand is only checked when the request names one; a franchise already
  // belongs to exactly one brand, so franchise/outlet are the real isolation.
  if (membership.brandId && requested.brandId && membership.brandId !== requested.brandId) {
    return false;
  }
  if (membership.franchiseId && membership.franchiseId !== requested.franchiseId) {
    return false;
  }
  if (membership.outletId && membership.outletId !== requested.outletId) {
    return false;
  }
  return true;
}

/**
 * Sensitive owner/internal actions require a session that completed a strong
 * challenge (mobile OTP) within this window (`advanced-login.md` "Fresh
 * Authentication for Sensitive Administration").
 */
export const FRESH_AUTH_SECONDS = 15 * 60;

export interface PolicyContext {
  /** Require MFA / step-up completed within this many seconds. */
  requireStepUpWithinSeconds?: number;
  /** Require an open shift bound to the actor. */
  requireOpenShift?: boolean;
  /** Require a registered terminal whose outlet equals this outlet. */
  requireTerminalOutlet?: string;
  /** Server "now"; injected for tests. */
  now?: Date;
}

export type AuthzDecision =
  | { allowed: true }
  | { allowed: false; reason: AuthzDenyReason };

export type AuthzDenyReason =
  | 'session_inactive'
  | 'account_inactive'
  | 'out_of_scope'
  | 'capability_not_granted'
  | 'step_up_required'
  | 'shift_required'
  | 'terminal_context_required';

/**
 * The single authorization gate. Allows only when every clause passes
 * (`docs/architecture/advanced-login.md` "Authorization"). Never branches on a
 * role name outside `ROLE_CAPABILITIES`.
 */
export function authorize(
  actor: ActorContext,
  capability: Capability,
  requested: AccessScope,
  policy: PolicyContext = {},
): AuthzDecision {
  if (!actor.sessionActive) {
    return { allowed: false, reason: 'session_inactive' };
  }
  if (actor.accountState !== 'active') {
    return { allowed: false, reason: 'account_inactive' };
  }
  if (actor.membership.status !== 'active') {
    return { allowed: false, reason: 'account_inactive' };
  }
  if (!scopeContains(actor.membership.scope, requested)) {
    return { allowed: false, reason: 'out_of_scope' };
  }
  if (!ROLE_CAPABILITIES[actor.membership.role].includes(capability)) {
    return { allowed: false, reason: 'capability_not_granted' };
  }

  if (policy.requireStepUpWithinSeconds !== undefined) {
    const since = actor.secondsSinceStepUp;
    if (since === undefined || since > policy.requireStepUpWithinSeconds) {
      return { allowed: false, reason: 'step_up_required' };
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

/** Every capability the actor's role can exercise. Navigation/UX only. */
export function grantedCapabilities(actor: ActorContext): readonly Capability[] {
  return ROLE_CAPABILITIES[actor.membership.role];
}
