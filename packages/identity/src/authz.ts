import type { AccessScope, ActorContext, Capability } from '@jksh/contracts';
import { authorize, type PolicyContext } from './authorize.js';
import { IdentityError } from './errors.js';

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
