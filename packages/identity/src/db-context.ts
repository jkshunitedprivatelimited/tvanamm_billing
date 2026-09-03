import type { DbContext } from '@jksh/db';
import type { ActorContext } from '@jksh/contracts';
import { IdentityError } from './errors.js';

/** Trusted pre-authentication identity operations (OTP link, PIN login,
 *  terminal registration, invitation acceptance). No user context yet. */
export function systemContext(): DbContext {
  return { request: 'system' };
}

/** The per-transaction RLS context for an authenticated actor. */
export function contextForActor(actor: ActorContext): DbContext {
  if (actor.kind === 'operator') {
    return {
      request: 'operator',
      organizationId: actor.scope.organizationId,
      ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
      ...(actor.outletId ? { outletId: actor.outletId } : {}),
      ...(actor.employeeId ? { operatorEmployeeId: actor.employeeId } : {}),
    };
  }
  if (actor.role === 'store_employee') {
    throw new IdentityError('forbidden', 'store_employee is not an admin role');
  }
  return {
    request: 'admin',
    role: actor.role,
    ...(actor.accountId ? { accountId: actor.accountId } : {}),
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
    ...(actor.scope.outletId ? { outletId: actor.scope.outletId } : {}),
  };
}
