import type { Pool, PoolClient } from 'pg';

/**
 * Per-transaction authorization context. The API opens every request in one of
 * these so `set local role identity_api` + the `app.*` GUCs are in force and
 * RLS + grants apply (`docs/plans/billing-data-api-plan.md` §2, §12).
 */
export interface DbContext {
  /**
   * - `system`: trusted pre-authentication identity ops (OTP link, PIN login,
   *   terminal registration, invitation acceptance). No user context yet.
   * - `admin`: an authenticated Central Admin / Accountant / Franchise Owner
   *   with a resolved workspace.
   * - `operator`: a PIN-authenticated Store Employee operator session.
   */
  request: 'system' | 'admin' | 'operator';
  accountId?: string;
  role?: 'central_admin' | 'accountant' | 'franchise_owner';
  organizationId?: string;
  franchiseId?: string;
  outletId?: string;
  operatorEmployeeId?: string;
}

const GUC_KEYS: Record<string, keyof DbContext> = {
  'app.request': 'request',
  'app.account_id': 'accountId',
  'app.role': 'role',
  'app.organization_id': 'organizationId',
  'app.franchise_id': 'franchiseId',
  'app.outlet_id': 'outletId',
  'app.operator_employee_id': 'operatorEmployeeId',
};

export async function applyContext(client: PoolClient, ctx: DbContext): Promise<void> {
  await client.query('set local role identity_api');
  for (const [guc, key] of Object.entries(GUC_KEYS)) {
    const value = ctx[key];
    if (value != null && value !== '') {
      await client.query('select set_config($1, $2, true)', [guc, value]);
    }
  }
}

/** Run `fn` in one transaction with the authorization context applied. */
export async function withActorContext<T>(
  pool: Pool,
  ctx: DbContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await applyContext(client, ctx);
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
