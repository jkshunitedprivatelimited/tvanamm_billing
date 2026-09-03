import 'server-only';
import { pgPool, type Pool } from '@jksh/db';

/** Process-wide connection pool for Route Handlers and Server Components. */
export function db(): Pool {
  return pgPool(process.env.DATABASE_URL);
}
