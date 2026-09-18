import { Pool, type PoolClient, type PoolConfig } from 'pg';

/**
 * Stock runs on a physically separate Supabase project / database. It never
 * shares a connection pool, a transaction, or a schema with Billing. The plan
 * caps this pool small (default five) because Stock route handlers release the
 * connection before any external HTTP / file work
 * (`docs/plans/stock-v1-build-plan.md` "Cost and Performance Constraints").
 */
let sharedStockPool: Pool | undefined;

function stockPoolConfig(connectionString: string): PoolConfig {
  const needsSsl =
    connectionString.includes('supabase.co') ||
    connectionString.includes('supabase.com') ||
    connectionString.includes('sslmode=require');

  return {
    connectionString,
    max: 5,
    keepAlive: true,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

function stockConnectionString(explicit?: string): string {
  const value = explicit ?? process.env.STOCK_DATABASE_URL;
  if (!value) {
    throw new Error('STOCK_DATABASE_URL is not set');
  }
  return value;
}

/** Process-wide Stock pool for privileged server work and tooling. */
export function stockPgPool(connectionString?: string): Pool {
  sharedStockPool ??= new Pool(stockPoolConfig(stockConnectionString(connectionString)));
  return sharedStockPool;
}

/** A dedicated Stock pool the caller owns and must `end()`. Used by the CLI. */
export function createStockPool(connectionString?: string): Pool {
  return new Pool(stockPoolConfig(stockConnectionString(connectionString)));
}

export async function closeStockPool(): Promise<void> {
  if (sharedStockPool) {
    await sharedStockPool.end();
    sharedStockPool = undefined;
  }
}

export type { Pool as StockPool, PoolClient as StockPoolClient };
