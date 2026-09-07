import 'server-only';
import { stockPgPool, type StockPool } from '@jksh/db';
import { resolveStockActor, type StockActor, type VerifiedIdentity } from '@jksh/stock';
import type { ActorContext } from '@jksh/contracts';
import { IdentityError } from '@jksh/identity';

/** The Stock database pool — a physically separate project from Billing. */
export function stockDb(): StockPool {
  return stockPgPool(process.env.STOCK_DATABASE_URL);
}

/**
 * Bridge a verified Billing Identity actor to a Stock actor. Stock issues no
 * login of its own; it resolves the session through its identity projection.
 */
export async function stockActorFor(
  actor: ActorContext,
  opts: { outletId?: string } = {},
): Promise<StockActor> {
  if (actor.kind === 'operator') {
    const outletId = opts.outletId ?? actor.outletId;
    const identity: VerifiedIdentity = {
      request: 'operator',
      billingRole: 'store_employee',
      organizationId: actor.scope.organizationId,
      ...(actor.employeeId ? { employeeId: actor.employeeId } : {}),
      ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
      ...(outletId ? { outletId } : {}),
    };
    return resolveStockActor(stockDb(), identity);
  }
  if (actor.role === 'store_employee') {
    throw new IdentityError('forbidden', 'store_employee is not an admin Stock role');
  }
  const identity: VerifiedIdentity = {
    request: 'admin',
    billingRole: actor.role,
    organizationId: actor.scope.organizationId,
    ...(actor.accountId ? { accountId: actor.accountId } : {}),
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
    ...(opts.outletId ? { outletId: opts.outletId } : {}),
  };
  return resolveStockActor(stockDb(), identity);
}
