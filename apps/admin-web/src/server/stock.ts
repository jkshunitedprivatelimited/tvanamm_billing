import 'server-only';
import { stockPgPool, type StockPool } from '@jksh/db';
import {
  isStockFeatureEnabled,
  resolveStockActor,
  StockError,
  type StockActor,
  type VerifiedIdentity,
} from '@jksh/stock';
import type { ActorContext } from '@jksh/contracts';
import { IdentityError } from '@jksh/identity';
import { actorOrThrow } from './http';

/** Resolve the current admin session to a Stock actor in one call. */
export async function currentStockActor(opts: { outletId?: string } = {}) {
  return stockActorFor(await actorOrThrow(), opts);
}

/** The Stock database pool — a physically separate project from Billing. */
export function stockDb(): StockPool {
  return stockPgPool(process.env.STOCK_DATABASE_URL);
}

/**
 * Bridge a verified Billing Identity actor to a Stock actor. Stock issues no
 * login of its own; it resolves the session through its identity projection.
 * The `stock.enabled` master pilot gate is enforced here for every non-Central
 * actor, so no Stock page or mutation runs while the flag is off.
 */
export async function stockActorFor(
  actor: ActorContext,
  opts: { outletId?: string } = {},
): Promise<StockActor> {
  let stockActor: StockActor;
  if (actor.kind === 'operator') {
    // An operator's outlet is terminal-bound; a URL cannot override it.
    const identity: VerifiedIdentity = {
      request: 'operator',
      billingRole: 'store_employee',
      organizationId: actor.scope.organizationId,
      ...(actor.employeeId ? { employeeId: actor.employeeId } : {}),
      ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
      ...(actor.outletId ? { outletId: actor.outletId } : {}),
    };
    stockActor = await resolveStockActor(stockDb(), identity);
  } else if (actor.role === 'store_employee') {
    throw new IdentityError('forbidden', 'store_employee is not an admin Stock role');
  } else {
    const identity: VerifiedIdentity = {
      request: 'admin',
      billingRole: actor.role,
      organizationId: actor.scope.organizationId,
      ...(actor.accountId ? { accountId: actor.accountId } : {}),
      ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
      ...(opts.outletId ? { outletId: opts.outletId } : {}),
    };
    stockActor = await resolveStockActor(stockDb(), identity);
  }

  if (stockActor.role !== 'central_admin') {
    const enabled = await isStockFeatureEnabled(stockDb(), 'stock.enabled');
    if (!enabled) {
      throw new StockError('forbidden', 'The Stock system is not enabled yet', {
        details: { flag: 'stock.enabled' },
      });
    }
  }
  return stockActor;
}
