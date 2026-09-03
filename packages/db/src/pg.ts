import { Pool, type PoolClient, type PoolConfig } from 'pg';

let sharedPool: Pool | undefined;

function poolConfig(connectionString: string): PoolConfig {
  const needsSsl =
    connectionString.includes('supabase.co') ||
    connectionString.includes('supabase.com') ||
    connectionString.includes('sslmode=require');

  return {
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

/** Process-wide pool for privileged server work and tooling. */
export function pgPool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  sharedPool ??= new Pool(poolConfig(connectionString));
  return sharedPool;
}

/** A dedicated pool that the caller owns and must `end()`. Used by the CLI. */
export function createPool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  return new Pool(poolConfig(connectionString));
}

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
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

export async function closePool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = undefined;
  }
}

export type { Pool, PoolClient };
