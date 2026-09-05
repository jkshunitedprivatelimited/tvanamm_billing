import { withActorContext, type Pool } from '@jksh/db';
import { systemContext } from './db-context';

/** Liveness/readiness check: confirms the pool can open a transaction and
 *  reach Postgres. No tenant data touched. */
export async function checkDatabaseHealth(pool: Pool): Promise<boolean> {
  await withActorContext(pool, systemContext(), async (client) => {
    await client.query('select 1');
  });
  return true;
}
