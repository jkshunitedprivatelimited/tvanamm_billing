import type { Pool, PoolClient } from 'pg';

/**
 * Per-transaction authorization context for the Stock database. Mirrors the
 * Billing `DbContext` shape but binds `set local role stock_api` and adds the
 * warehouse scope Stock needs. Stock never reads Billing tables and vice versa
 * (`docs/architecture/billing-stock-recipe-contract.md`).
 */
export interface StockDbContext {
  /**
   * - `system`: trusted internal work (event inbox processing, projection
   *   rebuilds, reconciliation jobs). No user context.
   * - `admin`: an authenticated Central Admin / Accountant / Franchise Owner /
   *   Warehouse Manager / Warehouse Staff resolved through the Stock identity
   *   projection.
   * - `operator`: a PIN-authenticated Store Employee operator session bound to
   *   one terminal outlet.
   */
  request: 'system' | 'admin' | 'operator';
  accountId?: string;
  role?:
    | 'central_admin'
    | 'accountant'
    | 'franchise_owner'
    | 'warehouse_manager'
    | 'warehouse_staff'
    | 'store_employee';
  organizationId?: string;
  franchiseId?: string;
  outletId?: string;
  operatorEmployeeId?: string;
  /** Comma-separated warehouse ids the actor is assigned to (manager/staff). */
  warehouseIds?: string;
}

const GUC_KEYS: Record<string, keyof StockDbContext> = {
  'app.request': 'request',
  'app.account_id': 'accountId',
  'app.role': 'role',
  'app.organization_id': 'organizationId',
  'app.franchise_id': 'franchiseId',
  'app.outlet_id': 'outletId',
  'app.operator_employee_id': 'operatorEmployeeId',
  'app.warehouse_ids': 'warehouseIds',
};

export async function applyStockContext(client: PoolClient, ctx: StockDbContext): Promise<void> {
  await client.query('set local role stock_api');
  for (const [guc, key] of Object.entries(GUC_KEYS)) {
    const value = ctx[key];
    if (value != null && value !== '') {
      await client.query('select set_config($1, $2, true)', [guc, value]);
    }
  }
}

/** Run `fn` in one Stock transaction with the authorization context applied. */
export async function withStockActorContext<T>(
  pool: Pool,
  ctx: StockDbContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await applyStockContext(client, ctx);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export function stockSystemContext(): StockDbContext {
  return { request: 'system' };
}
