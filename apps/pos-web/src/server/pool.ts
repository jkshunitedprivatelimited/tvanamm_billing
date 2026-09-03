import 'server-only';
import { pgPool, type Pool } from '@jksh/db';

export function db(): Pool {
  return pgPool(process.env.DATABASE_URL);
}
