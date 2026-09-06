import {
  STOCK_ROLE_CAPABILITIES,
  type StockActorRole,
  type StockCapability,
} from '@jksh/contracts';
import type { StockDbContext } from '@jksh/db';
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

/** The per-transaction RLS context for a Stock actor. */
export function stockContextForActor(actor: StockActor): StockDbContext {
  if (actor.request === 'system') return { request: 'system' };
  return {
    request: actor.request,
    role: actor.role,
    organizationId: actor.organizationId,
    ...(actor.accountId ? { accountId: actor.accountId } : {}),
    ...(actor.franchiseId ? { franchiseId: actor.franchiseId } : {}),
    ...(actor.outletId ? { outletId: actor.outletId } : {}),
    ...(actor.employeeId ? { operatorEmployeeId: actor.employeeId } : {}),
    ...(actor.warehouseIds.length > 0 ? { warehouseIds: actor.warehouseIds.join(',') } : {}),
  };
}

export function stockSystemActor(organizationId: string): StockActor {
  return { request: 'system', role: 'central_admin', organizationId, warehouseIds: [] };
}
