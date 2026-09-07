import {
  STOCK_ROLE_CAPABILITIES,
  type StockActorRole,
  type StockCapability,
} from '@jksh/contracts';
import {
  withStockActorContext,
  stockSystemContext,
  type StockDbContext,
  type StockPool,
} from '@jksh/db';
import { StockError } from './errors';

/**
 * A Stock request actor. Built by the route layer from an already-verified
 * Billing Identity session plus the Stock identity projection (which supplies
 * the warehouse role and assignments for warehouse staff). Stock never issues
 * its own login (`docs/architecture/franchise-owner-stock-portal.md`).
 */
export interface StockActor {
  request: 'system' | 'admin' | 'operator';
  role: StockActorRole;
  accountId?: string;
  employeeId?: string;
  organizationId: string;
  franchiseId?: string;
  /** For an operator this is the terminal-bound outlet; for an admin owner it
   *  is the outlet the request targets and MUST be checked with
   *  assertOutletInFranchise before use. */
  outletId?: string;
  warehouseIds: string[];
}

export function stockCapabilities(actor: StockActor): readonly StockCapability[] {
  return STOCK_ROLE_CAPABILITIES[actor.role];
}

export function stockActorHas(actor: StockActor, capability: StockCapability): boolean {
  return STOCK_ROLE_CAPABILITIES[actor.role].includes(capability);
}

/** Throw `forbidden` unless the actor's role grants `capability`. */
export function ensureStockAllowed(actor: StockActor, capability: StockCapability): void {
  if (!stockActorHas(actor, capability)) {
    throw new StockError('forbidden', `Missing capability: ${capability}`, {
      details: { capability, role: actor.role },
    });
  }
}

/**
 * Object-level check: the actor may operate on this specific warehouse. A
 * capability grant alone is not enough — a warehouse operator is bound to their
 * assigned warehouses (`stock.warehouse_assignments`), so a known UUID for
 * another warehouse must be rejected before any system-context write.
 */
export function assertWarehouseAccess(actor: StockActor, warehouseId: string): void {
  if (actor.request === 'system' || actor.role === 'central_admin') return;
  if (
    (actor.role === 'warehouse_manager' || actor.role === 'warehouse_staff') &&
    actor.warehouseIds.includes(warehouseId)
  ) {
    return;
  }
  throw new StockError('forbidden', 'Not assigned to this warehouse', {
    details: { warehouseId, role: actor.role },
  });
}

/**
 * Object-level check: an actor may operate on this specific outlet. Central and
 * Accountant see everything; a Franchise Owner is limited to outlets in their
 * franchise (verified against stock.outlet_stock_settings, not the URL); an
 * operator is limited to their terminal-bound outlet.
 */
export async function assertOutletInFranchise(
  pool: StockPool,
  actor: StockActor,
  outletId: string,
): Promise<void> {
  if (actor.request === 'system' || actor.role === 'central_admin' || actor.role === 'accountant') {
    return;
  }
  if (actor.request === 'operator') {
    if (actor.outletId && actor.outletId === outletId) return;
    throw new StockError('forbidden', 'Not your terminal outlet', { details: { outletId } });
  }
  if (actor.role === 'franchise_owner') {
    if (!actor.franchiseId) throw new StockError('forbidden', 'No franchise in scope');
    const { rowCount } = await withStockActorContext(pool, stockSystemContext(), (client) =>
      client.query(
        `select 1 from stock.outlet_stock_settings where outlet_id = $1 and franchise_id = $2`,
        [outletId, actor.franchiseId],
      ),
    );
    if (!rowCount) {
      throw new StockError('forbidden', 'Outlet is not in your franchise', {
        details: { outletId },
      });
    }
    return;
  }
  throw new StockError('forbidden', 'Not permitted for this outlet', { details: { outletId } });
}

/** The per-transaction RLS context for a Stock actor. */
export function stockContextForActor(actor: StockActor): StockDbContext {
  if (actor.request === 'system') return { request: 'system' };
  return {
    request: actor.request,
    role: actor.role,
    organizationId: actor.organizationId,
    ...(actor.accountId ? { accountId: actor.accountId } : {}),
    ...(actor.franchiseId ? { franchiseId: actor.franchiseId } : {}),
    // Only an operator's outlet is trusted in the RLS context: it comes from the
    // terminal session, not a URL. An admin owner is scoped by franchise_id and
    // must pass assertOutletInFranchise for outlet-level reads.
    ...(actor.request === 'operator' && actor.outletId ? { outletId: actor.outletId } : {}),
    ...(actor.employeeId ? { operatorEmployeeId: actor.employeeId } : {}),
    ...(actor.warehouseIds.length > 0 ? { warehouseIds: actor.warehouseIds.join(',') } : {}),
  };
}

export function stockSystemActor(organizationId: string): StockActor {
  return { request: 'system', role: 'central_admin', organizationId, warehouseIds: [] };
}
