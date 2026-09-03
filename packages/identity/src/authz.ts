import type { Pool } from '@jksh/db';
import type { AccessScope, ActorContext, AuditAction, Capability } from '@jksh/contracts';
import { authorize, type PolicyContext } from './authorize';
import { auditOutOfBand } from './audit';
import { IdentityError } from './errors';

/** Throw a typed forbidden/fresh-auth error unless the actor is allowed. */
export function ensureAllowed(
  actor: ActorContext,
  capability: Capability,
  scope: AccessScope,
  policy?: PolicyContext,
): void {
  const decision = authorize(actor, capability, scope, policy);
  if (!decision.allowed) {
    const code = decision.reason === 'fresh_auth_required' ? 'fresh_auth_required' : 'forbidden';
    throw new IdentityError(code, `Denied: ${decision.reason}`, {
      details: { reason: decision.reason, capability },
    });
  }
}

/**
 * Like `ensureAllowed`, but also writes a denial audit event in its own
 * transaction before throwing — so the record survives the caller's rollback.
 * Use for sensitive commands (outlet lifecycle, terminal enroll/revoke, PIN
 * reset, account status).
 */
export async function ensureAllowedAudited(
  pool: Pool,
  action: AuditAction,
  actor: ActorContext,
  capability: Capability,
  scope: AccessScope,
  policy?: PolicyContext,
): Promise<void> {
  const decision = authorize(actor, capability, scope, policy);
  if (decision.allowed) return;
  await auditOutOfBand(pool, {
    action,
    result: 'denied',
    actorAccountId: actor.accountId ?? null,
    actorEmployeeId: actor.employeeId ?? null,
    organizationId: scope.organizationId,
    franchiseId: scope.franchiseId ?? null,
    outletId: scope.outletId ?? null,
    metadata: { reason: decision.reason, capability },
  });
  const code = decision.reason === 'fresh_auth_required' ? 'fresh_auth_required' : 'forbidden';
  throw new IdentityError(code, `Denied: ${decision.reason}`, {
    details: { reason: decision.reason, capability },
  });
}
