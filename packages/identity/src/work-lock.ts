import type { PoolClient } from '@jksh/db';

/** Serialize shift starts, attendance changes and register closing for an outlet. */
export async function lockOutletWork(client: PoolClient, outletId: string): Promise<void> {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `outlet-work:${outletId}`,
  ]);
}
