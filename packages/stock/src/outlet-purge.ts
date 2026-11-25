import { withStockActorContext, type StockPool } from '@jksh/db';
import { StockError } from './errors';

export interface StockOutletPurge {
  organizationId: string;
  accountId?: string;
  outletId: string;
  /** Set only when the franchise is being removed together with its last outlet. */
  franchiseId: string | null;
  /** Owner logins Billing is deleting; their identity projection rows go too. */
  accountIds: string[];
}

/**
 * Remove every Stock row recorded against an outlet (migration 0025). Called by
 * Billing's outlet purge before the Billing rows are deleted. Idempotent: a
 * rerun after a partial failure deletes whatever is left. Central Admin only.
 */
export async function purgeOutletStock(pool: StockPool, input: StockOutletPurge): Promise<void> {
  await withStockActorContext(
    pool,
    {
      request: 'admin',
      role: 'central_admin',
      organizationId: input.organizationId,
      ...(input.accountId ? { accountId: input.accountId } : {}),
    },
    async (client) => {
      try {
        await client.query('select stock.purge_outlet($1, $2, $3::uuid[])', [
          input.outletId,
          input.franchiseId,
          input.accountIds,
        ]);
      } catch (error) {
        if ((error as { code?: string }).code === '42501')
          throw new StockError('forbidden', 'Only Central Admin can delete an outlet');
        throw error;
      }
    },
  );
}
